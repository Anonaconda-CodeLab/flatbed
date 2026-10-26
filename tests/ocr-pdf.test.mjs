// Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
// Text recognition with the bundled engine and language files (no network), then the PDF: searchable text layer,
// image-only option, and no hidden data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// the engine looks for Node's require() when it runs in Node (in the app it runs in a browser worker)
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = fileURLToPath(new URL('.', import.meta.url));

const file = f => readFileSync(new URL(f, import.meta.url));
const load = f => vm.runInThisContext(file(f).toString('utf8'), { filename: f });
load('../src/vendor/tesseract-core-simd-lstm.js');
load('../src/vendor/pdf-lib.min.js');
load('../src/clean.js');
await import('../src/ocr-engine.js');
await import('../src/pdf.js');
const { createEngine } = globalThis.FlatbedOcrEngine, PDFLib = globalThis.PDFLib, Clean = globalThis.UnmarkedClean, P = globalThis.FlatbedPdf;
const gz = f => new Uint8Array(gunzipSync(file(f)));

const eng = createEngine(globalThis.TesseractCore);
await eng.init(gz('../src/vendor/tesseract-core-simd-lstm.wasm.gz'));
for (const l of ['eng', 'tha']) eng.addLang(l, gz(`../src/lang/${l}.traineddata.gz`));
const en = eng.recognize(gz('./fixtures/text-en.pgm.gz'), ['eng']);

test('reads English offline', () => {
  assert.match(en.text, /Rental agreement for the flat/);
  assert.match(en.text, /12,500 baht/);
  assert.ok(en.words.length >= 12);
  assert.equal(new Set(en.words.map(w => w.line)).size, 2, 'two lines');
  const w = en.words[0];
  assert.ok(w.x > 30 && w.x < 70 && w.y > 30 && w.y < 60 && w.h > 20 && w.h < 60, JSON.stringify(w));
});

test('reads Thai offline, without spaces inside words, also alongside English', () => {
  for (const langs of [['tha'], ['eng', 'tha']]) {
    const th = eng.recognize(gz('./fixtures/text-th.pgm.gz'), langs);
    assert.match(th.text, /สัญญาเช่าห้องพัก/, langs.join('+'));
    assert.match(th.text, /ค่าเช่ารายเดือน/, langs.join('+'));
    assert.ok(th.words.length <= 4, `Thai pieces joined into words (${th.words.length})`);
  }
});

test('tidying: stray marks above a heading are dropped, Thai joined, sara am normalised', () => {
  const { tidy } = globalThis.FlatbedOcrEngine;
  const r = tidy([
    { text: '๑', x: 100, y: 10, w: 10, h: 12, line: 0, par: 'a', conf: 80 },        // marks above the heading
    { text: 'ชํ', x: 100, y: 8, w: 20, h: 50, line: 1, par: 'a', conf: 90 },
    { text: 'า', x: 120, y: 8, w: 20, h: 50, line: 1, par: 'a', conf: 90 },
    { text: 'Rent', x: 160, y: 8, w: 60, h: 50, line: 1, par: 'a', conf: 90 },
    { text: 'due', x: 100, y: 80, w: 40, h: 30, line: 2, par: 'b', conf: 90 }
  ]);
  assert.equal(r.text, 'ชำ Rent\n\ndue');
  assert.equal(r.words.length, 3);
  assert.deepEqual([r.words[0].x, r.words[0].w], [100, 40]);
});

test('every language file loads', () => {
  for (const l of ['fra', 'spa', 'deu']) eng.addLang(l, gz(`../src/lang/${l}.traineddata.gz`));
  const r = eng.recognize(gz('./fixtures/text-en.pgm.gz'), ['eng', 'fra', 'spa', 'deu']);
  assert.match(r.text, /Rental agreement/);
});

const font = file('../src/vendor/glyphless.ttf');
const jpeg = file('./fixtures/page.jpg');
const pageW = 1500, pageH = 260;   // page.jpg is the English test image
async function make(opts) {
  const bits = { stride: Math.ceil(pageW / 8), bits: new Uint8Array(Math.ceil(pageW / 8) * pageH).fill(0xff) };
  const raw = await P.build(Object.assign({ PDFLib, font, size: 'a4', text: true,
    pages: [{ w: pageW, h: pageH, image: { type: 'jpeg', bytes: jpeg }, words: en.words }, { w: pageW, h: pageH, image: Object.assign({ type: 'bits' }, bits), words: [] }] }, opts));
  return (await Clean.clean(raw, { pdfLib: PDFLib })).bytes;
}
const pdftotext = bytes => {
  const d = mkdtempSync(join(tmpdir(), 'flatbed-')), f = join(d, 'a.pdf');
  writeFileSync(f, bytes);
  try { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); } catch (e) { return null; }
};

test('PDF with a text layer: text can be found and copied', async () => {
  const pdf = await make({});
  const doc = await PDFLib.PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 2);
  const [pw, ph] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
  assert.ok(Math.abs(pw - 841.89) < 0.1 && Math.abs(ph - 595.28) < 0.1, 'wide scan -> landscape A4');
  const txt = pdftotext(pdf);
  if (txt === null) return;   // pdftotext not installed: the rest is checked in the browser test
  assert.match(txt, /Rental agreement for the flat/);
  assert.match(txt, /Monthly rent: 12,500 baht/);
});

test('image-only PDF has no text and no font', async () => {
  const pdf = await make({ text: false });
  assert.ok(!Buffer.from(pdf).toString('latin1').includes('GlyphLessFont'));
  const txt = pdftotext(pdf);
  if (txt !== null) assert.equal(txt.trim(), '');
});

test('the PDF carries no hidden data', async () => {
  for (const text of [true, false]) {
    const pdf = await make({ text });
    const s = Buffer.from(pdf).toString('latin1');
    for (const bad of ['/Producer', '/Creator', '/Author', '/CreationDate', '/ModDate', '/Title', '/ID', 'pdf-lib', '<x:xmpmeta']) assert.ok(!s.includes(bad), bad);
    const r = await Clean.inspect(pdf, { pdfLib: PDFLib });
    assert.equal(r.error, undefined);
    assert.deepEqual(r.findings.filter(f => Clean.isRemoved(f, {})).map(f => f.label), []);
  }
});

test('page sizes', async () => {
  for (const [size, w] of [['a4', 841.89], ['letter', 792], ['fit', 841.89]]) {
    const raw = await P.build({ PDFLib, font, size, text: false, pages: [{ w: pageW, h: pageH, image: { type: 'jpeg', bytes: jpeg } }] });
    const pg = (await PDFLib.PDFDocument.load(raw)).getPage(0);
    assert.ok(Math.abs(pg.getWidth() - w) < 0.1, `${size}: ${pg.getWidth()}`);
    if (size === 'fit') assert.ok(Math.abs(pg.getHeight() - 841.89 * pageH / pageW) < 0.1);
  }
});

test('page pictures carry no colour profile or other extra blocks (Chrome labels its profile "Google Inc.")', async () => {
  // a JPEG with an ICC profile, EXIF and a comment, like one made by a browser or a camera
  const seg = (m, body) => { const b = Buffer.from(body); return Buffer.concat([Buffer.from([0xff, m, (b.length + 2) >> 8, (b.length + 2) & 255]), b]); };
  const j = Buffer.from(jpeg), withJunk = Buffer.concat([j.subarray(0, 2), seg(0xe2, 'ICC_PROFILE\0Google Inc. 2016'), seg(0xe1, 'Exif\0\0secret'), seg(0xfe, 'made by me'), j.subarray(2)]);
  const bare = P.bareJpeg(new Uint8Array(withJunk));
  const t = Buffer.from(bare).toString('latin1');
  assert.ok(!/ICC_PROFILE|Google|Exif|made by me/.test(t));
  assert.ok(bare.length >= jpeg.length - 64 && bare.length <= jpeg.length, 'only the extra blocks removed');
  const raw = await P.build({ PDFLib, font, size: 'a4', text: false, pages: [{ w: pageW, h: pageH, image: { type: 'jpeg', bytes: new Uint8Array(withJunk) } }] });
  assert.ok(!/ICC_PROFILE|Google|Exif|made by me/.test(Buffer.from(raw).toString('latin1')));
});
