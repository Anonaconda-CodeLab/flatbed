// Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
// Checks the built page (run after `node build.mjs`): no network, everything inlined, settings filled in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dist = f => readFileSync(new URL('../dist/' + f, import.meta.url), 'utf8');
const file = f => readFileSync(new URL('../' + f, import.meta.url));
const pkg = JSON.parse(file('package.json'));
const html = dist('index.html');
const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');   // the page without its scripts and embedded data

test('page blocks all network access', () => {
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  // directive by directive: each appears once, and the blocking ones are exactly 'none' (nothing added after it)
  const dirs = new Map();
  for (const part of csp.split(';').map(x => x.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    assert.ok(!dirs.has(name), `${name} appears once`);
    dirs.set(name, values.join(' '));
  }
  for (const d of ['default-src', 'connect-src', 'form-action', 'frame-src', 'media-src', 'object-src']) assert.equal(dirs.get(d), "'none'", d);
  assert.equal(dirs.get('worker-src'), 'blob:');
  assert.ok(!/'unsafe-eval'/.test(csp), 'no JavaScript eval (only WebAssembly)');
  assert.ok(!/<script[^>]+src=/i.test(html), 'no external scripts');
  assert.ok(!/sourceMappingURL/.test(html), 'no source map reference');
});

test('everything is inlined: engine, five languages, font, app', () => {
  for (const id of ['srcWork', 'srcOcr', 'binWasm', 'binLang-eng', 'binLang-fra', 'binLang-spa', 'binLang-deu', 'binLang-tha']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes('TesseractCore') && html.includes('FlatbedScan') && html.includes('PDFLib') && html.includes('UnmarkedClean'));
  assert.ok(html.includes(`Version ${pkg.version}`));
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), 'unfilled placeholder');
  assert.ok(html.length < 12 * 1048576, 'page under 12 MB');
});

test('links open in the same tab; document content is kept from translators', () => {
  assert.ok(!/target="_blank"/.test(html));
  for (const id of ['cropStage', 'ocrText', 'fileName', 'doneSub']) assert.match(html, new RegExp(`id="${id}"[^>]*translate="no"|translate="no"[^>]*id="${id}"`), id);
  assert.match(html, /class="stage look" translate="no"/);
  assert.match(html, /class="page-n" translate="no"/);
});

test('dark pages: the Black text on white switch and the note on the PDF screen are in the page', () => {
  assert.match(html, /<label class="check" id="flipRow" hidden><input type="checkbox" id="optFlip">/);
  assert.match(html, /id="darkNote" hidden/);
  assert.match(html, /id="btnDarkAdjust"/);
});

test('clean.js is still Unmarked\'s (update tests/clean-origin.json when copying a newer one)', () => {
  const o = JSON.parse(file('tests/clean-origin.json'));
  assert.equal(createHash('sha256').update(file('src/clean.js')).digest('hex'), o.sha256);
});

test('Android page and manifest', () => {
  const on = /androidPage:\s*true/.test(file('build.mjs').toString());
  const sitemap = dist('sitemap.xml');
  assert.ok(!/\[\[\/?android\]\]/.test(html), 'manual markers removed');
  if (on) {
    const a = dist('android.html');
    assert.ok(a.includes(`Flatbed-${pkg.version}.apk`));
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(a));
    assert.ok(sitemap.includes('android.html'));
  } else {   // not announced yet: no install page, and the website says nothing about an Android app
    assert.ok(!existsSync(new URL('../dist/android.html', import.meta.url)));
    assert.ok(!sitemap.includes('android.html'));
    assert.ok(!/android\.html|Android app/.test(text), 'no Android app in the page text');
  }
  const m = JSON.parse(dist('manifest.webmanifest'));
  assert.equal(m.name, 'Flatbed');
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
});

test('Android app: version, no internet, no camera permission', () => {
  const g = file('mobile/android/app/build.gradle').toString();
  const [maj, min, pat] = pkg.version.split('.').map(Number);
  assert.match(g, new RegExp(`versionName "${pkg.version.replace(/\./g, '\\.')}"`));
  assert.match(g, new RegExp(`versionCode ${maj * 10000 + min * 100 + pat}\\b`));
  assert.match(g, /applicationId "com\.anonacondacodelab\.flatbed"/);
  assert.equal(JSON.parse(file('mobile/package.json')).version, pkg.version);
  const man = file('mobile/android/app/src/main/AndroidManifest.xml').toString();
  assert.match(man, /android\.permission\.INTERNET" tools:node="remove"/);
  assert.ok(!/permission\.CAMERA|READ_MEDIA|READ_EXTERNAL/.test(man), 'no camera or storage permission');
  assert.match(man, /android\.intent\.action\.SEND_MULTIPLE/);
  assert.ok(!/unmarked/i.test(man + g + file('mobile/capacitor.config.json')), 'nothing left over from Unmarked');
});

test('Cloudflare Pages headers: no framing, no connections, camera only for this page', () => {
  const h = dist('_headers');
  assert.match(h, /^\/\*\n/);
  assert.match(h, /Content-Security-Policy: [^\n]*connect-src 'none'[^\n]*frame-ancestors 'none'/);
  assert.match(h, /Referrer-Policy: no-referrer/);
  assert.match(h, /Strict-Transport-Security: max-age=31536000\n/);
  assert.match(h, /Permissions-Policy: camera=\(self\), microphone=\(\)/);
  assert.match(h, /https:\/\/:project\.pages\.dev\/\*\n  X-Robots-Tag: noindex/);
  assert.ok(!existsSync(new URL('../netlify.toml', import.meta.url)), 'no Netlify settings left');
  assert.match(html, /No ads, no tracking\. If you find this app useful, please consider <a [^>]+>making a small donation<\/a> to help fund development\. Thank you!/);
  assert.ok(!/made by one person/.test(html), 'the old donation line is gone');
});

test('Android app: shared files only from other apps, saving only where chosen, limits before reading, cache emptied', () => {
  const j = file('mobile/android/app/src/main/java/com/anonacondacodelab/flatbed/FlatbedPlugin.java').toString();
  const take = j.slice(j.indexOf('private boolean takeIntent'), j.indexOf('@PluginMethod', j.indexOf('private boolean takeIntent')));
  assert.equal((take.match(/got\.add\(u\)/g) || []).length, 3, 'three places take shared addresses');
  assert.equal((take.match(/if \(acceptable\(u\)\) got\.add\(u\)/g) || []).length, 3, 'each one checks the address');
  assert.match(j, /SCHEME_CONTENT\.equals\(u\.getScheme\(\)\)\s*&& !\(getContext\(\)\.getPackageName\(\) \+ "\.fileprovider"\)\.equals\(u\.getAuthority\(\)\)/);
  assert.match(j, /openOutputStream\(target, "wt"\)/);
  assert.ok(!/openOutputStream\(Uri\.parse/.test(j), 'never writes to an address the page passes');
  const load = j.slice(j.indexOf('public void load()'), j.indexOf('}', j.indexOf('public void load()')));
  assert.match(load, /deleteTree\(shareDir\(\)\)/);
  assert.match(load, /tidyCameraDir\(\)/);
  // the Android side reads no more than the page accepts
  const nat = file('src/native.js').toString(), app = file('src/app.js').toString();
  assert.equal(/NATIVE_MAX = ([\d *]+);/.exec(nat)[1].trim(), /MAX_BYTES = ([\d *]+);/.exec(app)[1].trim());
  assert.match(nat, /if \(\+it\.size > NATIVE_MAX\)/);
});

test('release workflow: three jobs, key only in the approved signing step, pinned actions', () => {
  const w = file('.github/workflows/android.yml').toString();
  assert.ok(!/tags:/.test(w), 'pushing a tag starts nothing');
  assert.match(w, /^permissions:\n  contents: read$/m);
  assert.equal((w.match(/contents: write/g) || []).length, 1, 'write access in one job only');
  const jobs = Object.fromEntries(w.slice(w.indexOf('\njobs:\n')).split(/\n(?=  [a-z]+:\n)/).slice(1).map(p => [p.trim().split(':')[0], p]));
  assert.deepEqual(Object.keys(jobs), ['build', 'sign', 'publish']);
  const { build, sign, publish } = jobs;
  assert.ok(!/secrets\./.test(build + publish), 'the key is used in the sign job only');
  assert.match(sign, /environment: signing/);
  assert.match(sign, /tr -d '\[:space:\]' \| base64 -d/);
  assert.match(sign, /to the 'signing' environment \(Settings > Environments > signing\)/, 'missing-key message points to the environment');
  assert.ok(!/npm |gradlew|node /.test(sign), 'the sign job runs no repository code');
  assert.match(build, /retention-days: 30/);
  assert.match(build, /if: \$\{\{ !inputs\.release \|\| github\.ref == 'refs\/heads\/main' \}\}/, 'a release run off main signs nothing');
  for (const p of ['INTERNET', 'CAMERA']) assert.match(sign, new RegExp(`grep -q "android\\.permission\\.${p}" perms\\.txt; then echo "::error::${p} permission found"; exit 1`), p);
  for (const f of ['android.yml', 'ci.yml']) {
    const uses = file('.github/workflows/' + f).toString().match(/uses: \S+/g);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${f}: ${u} pinned to a commit`);
  }
  assert.ok(!/persist-credentials: true/.test(w));
  assert.equal((w.match(/actions\/checkout@/g) || []).length, (w.match(/persist-credentials: false/g) || []).length);
});
