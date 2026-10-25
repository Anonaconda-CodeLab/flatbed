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
  for (const d of ["default-src 'none'", "connect-src 'none'", 'worker-src blob:', "form-action 'none'", "frame-src 'none'", "media-src 'none'", "object-src 'none'"]) assert.ok(csp.includes(d), d);
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
  assert.match(h, /Permissions-Policy: camera=\(self\), microphone=\(\)/);
  assert.match(h, /https:\/\/:project\.pages\.dev\/\*\n  X-Robots-Tag: noindex/);
  assert.ok(!existsSync(new URL('../netlify.toml', import.meta.url)), 'no Netlify settings left');
  assert.match(html, /made by one person, with no ads or tracking/);
});
