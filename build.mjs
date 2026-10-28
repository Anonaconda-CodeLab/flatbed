#!/usr/bin/env node
// Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
// Builds dist/index.html: a single self-contained page (fonts, styles, scripts, pdf-lib, the text-recognition engine
// and its language files all inlined) with a strict Content Security Policy that blocks every network request.
//   node build.mjs              -> dist/index.html (+ icons, web manifest, robots.txt, sitemap.xml)
// dist/ is not committed: Cloudflare Pages runs this build and publishes dist/ (with dist/_headers), and the Android
// workflow does the same.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// ---- project settings (edit these) ----
const PROJECT = {
  name: 'Flatbed',
  appUrl: 'https://flatbed.anonacondacodelab.com', // the public address of the app
  repoUrl: 'https://github.com/Anonaconda-CodeLab/flatbed', // shown in About and on the Android page
  contact: 'hello@anonacondacodelab.com', // support address shown in About and the manual; leave empty to hide
  // SHA-256 of the Android signing certificate (the studio's shared key), published so people can check an APK is official
  certSha256: '4D:6C:EA:58:94:C0:D7:D8:E9:AB:74:BC:3A:1E:9C:A5:47:BD:40:A2:02:B6:70:99:AF:66:5B:29:7F:7A:8F:47',
  kofi: 'anonacondacodelab', // Ko-fi username; leave empty to hide the support link
  // Android app announced on the website: the install page (dist/android.html) and the manual's [[android]] parts.
  // On since the launch (1.0.0); false hides them again. The APK itself is built either way.
  androidPage: true,
  // text-recognition languages bundled with the app (src/lang/<code>.traineddata.gz), in the order shown
  languages: [['eng', 'English'], ['fra', 'Français'], ['spa', 'Español'], ['deu', 'Deutsch'], ['tha', 'ไทย']]
};
const APP = { APP_NAME: PROJECT.name, VERSION: pkg.version };
const appUrl = /^https:\/\/[\w.-]+\/?$/.test(PROJECT.appUrl) ? PROJECT.appUrl.replace(/\/$/, '') : '';
APP.APP_URL = appUrl || 'its https web address';
APP.APP_HOST = appUrl ? appUrl.replace('https://', '') : 'the https address';
const safeUrl = u => /^https:\/\/[\w.-]+(\/[\w./%-]*)?$/.test(u) ? u : '';
const contact = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(PROJECT.contact) ? PROJECT.contact : '';
// the commit an APK was built from: the Android workflow sets LEADONE_BUILD_ID (the studio's shared name for it)
const BUILD = /^[0-9a-f]{40}$/.test(process.env.LEADONE_BUILD_ID || '') ? process.env.LEADONE_BUILD_ID.slice(0, 7) : '';
const repo = safeUrl(PROJECT.repoUrl), kofi = /^[A-Za-z0-9_]{1,60}$/.test(PROJECT.kofi) ? 'https://ko-fi.com/' + PROJECT.kofi : '';
const about = `<div class="card" id="aboutCard">
      <div><div class="dev-name">About ${APP.APP_NAME}</div><div class="dev-meta">Version ${APP.VERSION}${BUILD ? ` · build ${BUILD}` : ''} · free and open source (GNU GPL v3) · runs entirely on this device</div></div>
      <p class="dev-meta" style="margin:0">© 2026 Anonaconda Code Lab. You may use, share and modify this app under the GNU General Public License v3 or later; it comes with no warranty. Text recognition by Tesseract (Apache License 2.0).</p>
      ${contact ? `<p class="dev-meta" style="margin:0">Questions or problems: <a href="mailto:${contact}">${contact}</a>. A description or a screenshot of the app is usually enough; please don't send the documents you were scanning.</p>` : ''}
      <div class="acts-row"><button id="btnHelp2" class="btn">User manual</button>${appUrl && PROJECT.androidPage ? `<a class="btn native-only" href="${appUrl}/android.html?v=${APP.VERSION}" rel="noopener noreferrer">Check for updates</a>` : ''}${repo ? `<a class="btn" href="${repo}" rel="noopener noreferrer">Source code</a>` : ''}${kofi ? `<a class="btn coffee" href="${kofi}" rel="noopener noreferrer">☕ Support on Ko-fi</a>` : ''}</div>
    </div>`;

// gentle donation card after a PDF is made, shown at a few usage milestones only (see app.js); same as the studio's other apps
const donate = kofi ? `<div id="donateCard" class="card donate" hidden>
      <p><b>Enjoying ${APP.APP_NAME}?</b><br><span class="dev-meta">You've made <span id="donateN">20</span> PDFs. No ads, no tracking. If you find this app useful, please consider making a small donation to help fund development. Thank you!</span></p>
      <div class="acts"><a id="btnDonate" class="btn coffee" href="${kofi}" rel="noopener noreferrer">☕ Support on Ko-fi</a><button id="btnDonateLater" class="btn">Not now</button></div>
    </div>` : '';
const thanks = kofi ? `<p class="thanks">No ads, no tracking. If you find this app useful, please consider <a href="${kofi}" rel="noopener noreferrer">making a small donation</a> to help fund development. Thank you!</p>` : '';

const src = f => readFileSync(join(root, 'src', f), 'utf8');
const bin = f => readFileSync(join(root, 'src', f));

// minimal Markdown renderer for docs/MANUAL.md (headings, paragraphs, lists, '> ' callouts, bold, italics, code, https links)
function md(text) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/(?<!["\/])\bhttps:\/\/[\w.\/-]+[\w\/]/g, u => `<a href="${u}" rel="noopener noreferrer">${u.replace('https://', '')}</a>`);
  const out = []; let para = [], list = null, quote = null;
  const flushP = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const flushL = () => { if (list) out.push(`<${list.t}>${list.items.map(i => `<li>${inline(i.text)}${i.sub.length ? `<ul>${i.sub.map(x => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</${list.t}>`); list = null; };
  const flushQ = () => { if (quote) out.push(`<div class="callout">${md(quote.join('\n'))}</div>`); quote = null; };
  for (const line of text.split('\n')) {
    if (/^>( |$)/.test(line)) { flushP(); flushL(); (quote = quote || []).push(line.replace(/^> ?/, '')); continue; }
    flushQ();
    const h = line.match(/^(#{1,3}) (.*)/), li = line.match(/^(-|\d+\.) (.*)/), sub = line.match(/^ {2,3}- (.*)/), cont = /^ {2,}\S/.test(line);
    if (/^-{3,}$/.test(line)) { flushP(); flushL(); out.push('<hr>'); }
    else if (h) { flushP(); flushL(); const n = h[1].length; if (n > 1) out.push(`<h${n}>${inline(h[2])}</h${n}>`); }
    else if (li) { flushP(); const t = li[1] === '-' ? 'ul' : 'ol'; if (!list || list.t !== t) { flushL(); list = { t, items: [] }; } list.items.push({ text: li[2], sub: [] }); }
    else if (sub && list) list.items[list.items.length - 1].sub.push(sub[1]);
    else if (cont && list) { const it = list.items[list.items.length - 1]; if (it.sub.length && /^ {4,}\S/.test(line)) it.sub[it.sub.length - 1] += ' ' + line.trim(); else it.text += ' ' + line.trim(); }
    else if (!line.trim()) { flushP(); flushL(); }
    else { flushL(); para.push(line.trim()); }
  }
  flushP(); flushL(); flushQ(); return out.join('\n');
}
// [[android]] ... [[/android]] in the manual: kept (markers removed) when the Android app is announced, else left out
const manualText = readFileSync(join(root, 'docs', 'MANUAL.md'), 'utf8')
  .replace(/\[\[android\]\]\n?([\s\S]*?)\[\[\/android\]\]\n?/g, (_, body) => PROJECT.androidPage ? body : '');
if (/\[\[\/?android\]\]/.test(manualText)) throw new Error('Unbalanced [[android]] marker in docs/MANUAL.md');
const manual = md(manualText);
const b64 = f => bin(f).toString('base64');
const langChips = PROJECT.languages.map(([c, n]) => `<button type="button" class="chip-btn" data-lang="${c}" aria-pressed="false" translate="no">${n}</button>`).join('');
const fill = s => s.replace(/\{\{(APP_NAME|VERSION|APP_URL|APP_HOST)\}\}/g, (_, k) => APP[k]).replace('{{ABOUT}}', about).replace('{{DONATE}}', donate)
  .replace('{{THANKS}}', thanks).replace('{{LANG_CHIPS}}', langChips).replace('{{MANUAL}}', () => manual);

const fonts = `@font-face{font-family:"Instrument Sans";font-style:normal;font-display:swap;font-weight:400 700;font-stretch:75% 100%;src:url(data:font/woff2;base64,${b64('fonts/InstrumentSans-latin-variable.woff2')}) format("woff2-variations")}
@font-face{font-family:"IBM Plex Mono";font-style:normal;font-display:swap;font-weight:400;src:url(data:font/woff2;base64,${b64('fonts/IBMPlexMono-latin-400.woff2')}) format("woff2")}
@font-face{font-family:"IBM Plex Mono";font-style:normal;font-display:swap;font-weight:500;src:url(data:font/woff2;base64,${b64('fonts/IBMPlexMono-latin-500.woff2')}) format("woff2")}`;

const css = `<style>${fonts}\n${src('style.css')}</style>`;
// pdf-lib (MIT) goes in its own script tag, unchanged; the app's own code follows
const pdfLib = src('vendor/pdf-lib.min.js').replace(/\n?\/\/# sourceMappingURL=\S*\s*$/, '');
const noClose = (name, s) => { if (/<\/script/i.test(s)) throw new Error(name + ' contains a closing script tag'); return s; };
noClose('pdf-lib', pdfLib);
const settings = `const FLATBED = ${JSON.stringify({ languages: PROJECT.languages, font: b64('vendor/glyphless.ttf') })};`;
const appJs = noClose('app', `${settings}\n${src('scan.js')}\n${src('clean.js')}\n${src('pdf.js')}\n${src('ocr.js')}\n${fill(src('native.js'))}\n${fill(src('app.js'))}`);
// the two workers: their code sits in the page as plain text and is started from a blob: address (no download)
const workJs = noClose('page worker', `${src('scan.js')}\n${src('work.js')}`);
const ocrJs = noClose('text recognition', `${src('vendor/tesseract-core-simd-lstm.js').replace(/\n?\/\/# sourceMappingURL=\S*\s*$/, '')}\n${src('ocr-engine.js')}`);
// the engine's WebAssembly code and the language files, gzipped, as base64 (unpacked in the browser when first needed)
const data = [`<script type="application/octet-stream" id="binWasm">${b64('vendor/tesseract-core-simd-lstm.wasm.gz')}</script>`]
  .concat(PROJECT.languages.map(([c]) => `<script type="application/octet-stream" id="binLang-${c}">${b64(`lang/${c}.traineddata.gz`)}</script>`)).join('\n');
const js = `<script type="text/plain" id="srcWork">\n${workJs}\n</script>\n<script type="text/plain" id="srcOcr">\n${ocrJs}\n</script>\n${data}\n<script>\n${pdfLib}\n</script>\n<script>\n${appJs}\n</script>`;
const body = fill(src('body.html'));
const title = `<title>${APP.APP_NAME}</title>`;
const DESC = 'Scan documents with your phone: crop, straighten, clean up, read the text and save a searchable PDF. Free, open source, and nothing leaves your device.';
const OG_IMAGE = 'https://anonacondacodelab.com/social/og-flatbed.jpg';
const seo = appUrl ? `<link rel="canonical" href="${appUrl}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Anonaconda Code Lab">
<meta property="og:title" content="${APP.APP_NAME}">
<meta property="og:description" content="${DESC}">
<meta property="og:url" content="${appUrl}/">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${APP.APP_NAME}: a photo of a letter on a table, and the same letter as a clean, flat, searchable PDF">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${APP.APP_NAME}">
<meta name="twitter:description" content="${DESC}">
<meta name="twitter:image" content="${OG_IMAGE}">` : '';

// No connections of any kind (connect-src 'none'). Workers are allowed only from blob: addresses the page makes from
// its own inlined code, and 'wasm-unsafe-eval' lets the text-recognition engine (WebAssembly) start; neither can
// reach the network.
const CSP = ["default-src 'none'", "script-src 'unsafe-inline' 'wasm-unsafe-eval'", "style-src 'unsafe-inline'", 'font-src data:', "img-src 'self' data: blob:",
  "connect-src 'none'", "media-src 'none'", "object-src 'none'", "frame-src 'none'", "worker-src blob:", "manifest-src 'self'",
  "base-uri 'none'", "form-action 'none'"].join('; ');

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#a3541b">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="description" content="${DESC}">
${title}
${seo}
<style>html{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>
${css}
</head><body>
${body}
${js}
</body></html>
`;

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(root, 'dist'), { recursive: true });
const file = join(root, 'dist', 'index.html');
writeFileSync(file, page);

// home-screen install: a web manifest and local icons (no service worker; the page itself never touches the network)
for (const f of readdirSync(join(root, 'src', 'icons'))) copyFileSync(join(root, 'src', 'icons', f), join(root, 'dist', f));
writeFileSync(join(root, 'dist', 'manifest.webmanifest'), JSON.stringify({
  name: APP.APP_NAME, short_name: APP.APP_NAME, id: '/', start_url: '/', scope: '/', display: 'standalone',
  background_color: '#f6f2ea', theme_color: '#a3541b',
  description: 'Scan documents to clean, searchable PDFs, entirely on your device.',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
  ]
}, null, 2) + '\n');
// the Android download page (also the target of the app's Check for updates button: android.html?v=<installed version>)
if (PROJECT.androidPage) writeFileSync(join(root, 'dist', 'android.html'), src('android.html').replace(/\{\{(VERSION|REPO|CERT|CONTACT_LINE|APP_NAME|APP_URL)\}\}/g, (_, k) =>
  ({ VERSION: APP.VERSION, REPO: repo, CERT: PROJECT.certSha256, APP_NAME: APP.APP_NAME, APP_URL: appUrl || '',
     CONTACT_LINE: contact ? ` · Questions or problems: <a href="mailto:${contact}">${contact}</a>` : '' })[k]));
// HTTP headers for Cloudflare Pages. The page's own Content Security Policy (in index.html) does the real work; these
// add what a <meta> tag can't (no framing by other sites) and a second, header-level block on all connections. A
// browser applies both policies, so a page is only ever allowed what both permit.
writeFileSync(join(root, 'dist', '_headers'), `/*
  Content-Security-Policy: connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin
  Strict-Transport-Security: max-age=31536000

# the project's own *.pages.dev address is a duplicate of the real one: keep it out of search engines
https://:project.pages.dev/*
  X-Robots-Tag: noindex
`);
if (appUrl) {
  writeFileSync(join(root, 'dist', 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${appUrl}/sitemap.xml\n`);
  writeFileSync(join(root, 'dist', 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${appUrl}/</loc></url>
${PROJECT.androidPage ? `  <url><loc>${appUrl}/android.html</loc></url>\n` : ''}</urlset>
`);
}

// sanity checks: the scripts parse, no remote resources
new Function(appJs); new Function(workJs);
const stripped = page.replace(/<code>[^<]*<\/code>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
// anything the page would load by itself (scripts, styles, images, frames) must be local; plain <a href> links are allowed
const remote = stripped.match(/\bsrc\s*=\s*["']https?:|<link\b(?![^>]*rel="canonical")[^>]*href\s*=\s*["']https?:|url\(\s*["']?https?:/gi);
if (remote) { console.error('Remote resource reference found:', remote); process.exit(1); }
if (/target="_blank"/.test(page)) { console.error('Links open in the same tab: target="_blank" found'); process.exit(1); }
console.log(`${APP.APP_NAME} ${APP.VERSION} -> ${file} (${(page.length / 1048576).toFixed(1)} MB)`);
