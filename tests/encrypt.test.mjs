// Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
// "Save PDF with a password": AES-256 (V 5, R 6). The key derivation is checked against values qpdf made; every
// protected PDF is opened again with qpdf and Poppler (the readers behind many Linux tools), with the right password and
// a wrong one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

const file = f => readFileSync(new URL(f, import.meta.url));
const load = f => vm.runInThisContext(file(f).toString('utf8'), { filename: f });
load('../src/vendor/pdf-lib.min.js');
load('../src/clean.js');
load('../src/encrypt.js');
await import('../src/pdf.js');
const { PDFLib, UnmarkedClean: C, FlatbedPdf: P, FlatbedEncrypt: E } = globalThis;
const hexOf = h => Uint8Array.from(Buffer.from(h, 'hex'));
const has = (cmd, flag) => { try { execFileSync(cmd, [flag], { stdio: 'ignore' }); return true; } catch { return false; } };
const QPDF = has('qpdf', '--version'), POPPLER = has('pdftotext', '-v');   // pdftotext knows -v, not --version (CodeRabbit, PR #5)
const dir = mkdtempSync(join(tmpdir(), 'flatbed-enc-'));
const put = (name, bytes) => { const f = join(dir, name); writeFileSync(f, bytes); return f; };
const run = (cmd, args) => { try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { ok: false, out: String(e.stderr || e.message) }; } };

// a two-page PDF as the app makes it: pictures, an English and Thai text layer, then Unmarked's cleaner
const font = new Uint8Array(file('../src/vendor/glyphless.ttf')), jpeg = new Uint8Array(file('./fixtures/page.jpg'));
const words = [{ text: 'Rental', x: 100, y: 40, w: 180, h: 40, line: 0 }, { text: 'agreement', x: 300, y: 40, w: 260, h: 40, line: 0 },
  { text: 'สัญญาเช่า', x: 600, y: 40, w: 300, h: 40, line: 0 }];
const page = { w: 1500, h: 260, image: { type: 'jpeg', bytes: jpeg }, words };
const raw = await P.build({ PDFLib, font, size: 'a4', text: true, pages: [page, page] });
const clean = (await C.clean(raw, { pdfLib: PDFLib })).bytes;
const plainText = POPPLER ? run('pdftotext', [put('plain.pdf', clean), '-']).out : '';

test('key derivation matches qpdf (ISO 32000-2 Algorithm 2.B), English and Thai passwords', async () => {
  const kat = JSON.parse(file('./fixtures/qpdf-r6.json'));
  assert.ok(kat.cases.length >= 3);
  for (const c of kat.cases) {
    const pw = E.passwordBytes(c.password), U = hexOf(c.U);
    assert.deepEqual(await E.hash2B(pw, U.subarray(32, 40)), U.subarray(0, 32), `/U for ${c.password}`);
    // /UE is the file key encrypted with the key-salt hash: AES-256-CBC, zero IV, no padding
    const k = await crypto.subtle.importKey('raw', await E.hash2B(pw, U.subarray(40, 48)), 'AES-CBC', false, ['encrypt']);
    const ue = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, k, hexOf(c.key))).subarray(0, 32);
    assert.deepEqual(ue, hexOf(c.UE), `/UE for ${c.password}`);
  }
});

const passwords = {
  'a plain one': 'correct horse battery staple',
  'Thai, with sara am (typed as one character)': 'รหัสผ่านสำคัญ',
  'short Thai with sara am (also read with Poppler)': 'ลับสำคัญ',
  'one character': 'x',
  'the longest allowed (127 bytes: 42 Thai letters and a space)': 'ก'.repeat(42) + ' ',
  'with symbols and spaces': ' ¡Hola! Ünïcødé & 中文 (100%) ',
};
for (const [what, pw] of Object.entries(passwords)) {
  test(`protected PDF opens with the password and not without: ${what}`, async t => {
    if (!QPDF) return t.skip('qpdf not installed');
    const f = put('p.pdf', await E.encrypt(clean, pw, { PDFLib }));
    const shown = run('qpdf', ['--show-encryption', '--password=' + pw, f]);
    assert.ok(shown.ok, shown.out);
    assert.match(shown.out, /R = 6/);
    assert.match(shown.out, /Supplied password is user password/);
    assert.match(shown.out, /print high resolution: allowed/);
    assert.match(shown.out, /extract for any purpose: allowed/);
    const check = run('qpdf', ['--check', '--password=' + pw, f]);
    assert.ok(check.ok && /No syntax or stream encoding errors found/.test(check.out), check.out);
    assert.match(run('qpdf', ['--show-npages', '--password=' + pw, f]).out, /^2\s*$/);
    for (const wrong of ['', 'wrong', (pw.startsWith('y') ? 'z' : 'y') + pw.slice(1)]) {
      if (wrong === pw) continue;
      assert.ok(!run('qpdf', ['--check', '--password=' + wrong, f]).ok, `wrong password "${wrong}" refused`);
    }
    // pdftotext's -upw takes at most 32 bytes (a fixed buffer in the command, not Poppler itself), so longer ones are
    // left to qpdf above
    if (POPPLER && Buffer.byteLength(pw) <= 32) assert.equal(run('pdftotext', ['-upw', pw, f, '-']).out, plainText, 'the same text as the unprotected PDF');
  });
}

test('nothing readable is left in the protected file: text, pictures and metadata are all encrypted', async () => {
  const enc = Buffer.from(await E.encrypt(clean, 'secret', { PDFLib }));
  const s = enc.toString('latin1');
  // every stream of the unprotected PDF (pictures, the text layer, the font) is gone: none of their bytes are left as
  // they were (64 bytes from each one's start; an accidental match in random ciphertext is practically impossible)
  const doc = await PDFLib.PDFDocument.load(clean, { updateMetadata: false });
  let streams = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFLib.PDFRawStream) || obj.contents.length < 64) continue;
    streams++;
    assert.equal(enc.indexOf(Buffer.from(obj.contents.subarray(0, 64))), -1, 'a stream is still readable');
  }
  assert.ok(streams >= 4, `pictures, text layers and the font were checked (${streams} streams)`);
  for (const w of ['Rental', 'agreement']) assert.ok(!s.includes(w), w);
  for (const k of ['/Info', '/Metadata', '/Producer', '/Creator', '/CreationDate', '/ModDate', '/ObjStm']) assert.ok(!s.includes(k), k);
  assert.match(s, /\/Filter \/Standard/);
  assert.match(s, /\/V 5/); assert.match(s, /\/R 6/); assert.match(s, /\/CFM \/AESV3/); assert.match(s, /\/P -4/);
});

// The standard says readers use the first 127 bytes; qpdf does, but Chrome (PDFium) hashes the whole password, so a
// longer one would open in some readers and not others. The app refuses it.
test('over 127 bytes readers disagree, so the app refuses longer passwords', async t => {
  if (!QPDF) return t.skip('qpdf not installed');
  const long = 'ภาษาไทย-'.repeat(30), f = put('l.pdf', await E.encrypt(clean, long, { PDFLib }));
  assert.ok(run('qpdf', ['--check', '--password=' + long.slice(0, -5) + 'xxxxx', f]).ok, 'a different ending still opens it');
  assert.match(file('../src/app.js').toString(), /passwordBytes\(pw\)\.length < new TextEncoder\(\)\.encode\(pw\)\.length/, 'the app checks for it');
});

// the file key, recovered the way a reader does: /UE decrypted with the key-salt hash of the password (AES-256-CBC,
// zero IV, no padding), and checked by opening /Perms with it
async function fileKey(pdf, pw) {
  const s = Buffer.from(pdf).toString('latin1'), val = k => hexOf(new RegExp(`/${k} <([0-9a-fA-F]+)>`).exec(s)[1]);
  const U = val('U'), UE = val('UE'), Perms = val('Perms');
  const dec = (key, data) => { const d = createDecipheriv(key.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc', key, Buffer.alloc(16)); d.setAutoPadding(false); return Buffer.concat([d.update(data), d.final()]); };
  const key = dec(await E.hash2B(E.passwordBytes(pw), U.subarray(40, 48)), UE);
  assert.equal(dec(key, Perms).subarray(9, 12).toString('latin1'), 'adb', '/Perms opens with the recovered key');
  return key;
}
test('every PDF gets its own key: two protections of the same file differ (CodeRabbit, PR #5)', async () => {
  const a = await E.encrypt(clean, 'same', { PDFLib }), b = await E.encrypt(clean, 'same', { PDFLib });
  assert.notDeepEqual(Buffer.from(a), Buffer.from(b));
  const ka = await fileKey(a, 'same'), kb = await fileKey(b, 'same');
  assert.equal(ka.length, 32);
  assert.notDeepEqual(ka, kb, 'a new random file key each time');
});

test('no password, no protection: an empty password is refused', async () => {
  await assert.rejects(E.encrypt(clean, '', { PDFLib }), /No password/);
});

test('passwords are the typed UTF-8 bytes, at most 127 (no SASLprep, so Chrome, Firefox and Android agree)', () => {
  assert.deepEqual(E.passwordBytes('ำ'), Uint8Array.from([0xE0, 0xB8, 0xB3]), 'Thai sara am stays one character');
  assert.equal(E.passwordBytes('ก'.repeat(100)).length, 127);
  assert.equal(E.passwordBytes('abc').length, 3);
});
