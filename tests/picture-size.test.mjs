// Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
// Picture-size bombs: a small file that declares enormous dimensions is refused from its header, before anything
// decodes it (decoding a 40000 x 40000 picture needs over 6 GB and crashes the page or the app).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import '../src/scan.js';
const S = globalThis.FlatbedScan;
const hex = s => Uint8Array.from(Buffer.from(s, 'hex'));

// ---------- a real, valid PNG of 40000 x 40000 grey pixels, all one colour ----------
// Built by hand so no 1.6 GB buffer is needed: zlib data in one fixed-Huffman block, a literal 0 followed by
// back-references of 258 bytes at distance 1 (13 bits each), so 1.6 GB of pixel data packs into about 10 MB.
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function bombPng(w, h) {
  const total = (w + 1) * h;   // a filter byte (0) and w grey bytes per row, all zero
  const bytes = new Uint8Array(Math.ceil(total / 258 * 13 / 8) + 300); let len = 0, acc = 0, nbits = 0;
  const put = (v, n) => { acc |= v << nbits; nbits += n; while (nbits >= 8) { bytes[len++] = acc & 255; acc >>>= 8; nbits -= 8; } };
  const code = (c, n) => { let r = 0; for (let i = 0; i < n; i++) r = r << 1 | (c >> i & 1); put(r, n); };   // Huffman codes go most significant bit first
  put(1, 1); put(1, 2);                 // last block, fixed Huffman codes
  code(0x30, 8);                        // literal 0
  let left = total - 1;
  while (left >= 258) { code(0xC5, 8); code(0, 5); left -= 258; }   // length 258 (code 285), distance 1 (code 0)
  while (left-- > 0) code(0x30, 8);     // the last few as literals
  code(0, 7);                           // end of block (code 256)
  if (nbits) bytes[len++] = acc & 255;
  const z = Buffer.concat([Buffer.from([0x78, 0x01]), bytes.subarray(0, len), Buffer.alloc(4)]);   // Adler-32 of all zeros
  let a = 1, b = 0; const MOD = 65521;
  for (let n = total; n > 0;) { const k = Math.min(n, 5552); b = (b + a * k) % MOD; n -= k; }   // a stays 1 (all zeros)
  z.writeUInt32BE((b << 16 | a) >>> 0, z.length - 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;   // 8-bit grey
  return new Uint8Array(Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', Buffer.alloc(0))]));
}

test('a generated 40000 x 40000 PNG is refused from its header, quickly', () => {
  const png = bombPng(40000, 40000);
  assert.ok(png.length < 12 * 1024 * 1024, `small file (${png.length} bytes), well under the 60 MB file limit`);
  // it really is a valid PNG: the zlib data starts unpacking to rows of zeros
  const idat = png.subarray(33 + 8, 33 + 8 + 4096);
  const head = inflateSync(idat, { finishFlush: 2 /* Z_SYNC_FLUSH: what the first 4 KB unpack to */ });
  assert.ok(head.length > 100000 && head.every(v => v === 0), 'unpacks to zeros');
  const t = performance.now();
  const big = S.tooLarge(png);
  assert.ok(performance.now() - t < 50, 'answered from the header, not by decoding');
  assert.deepEqual(big, { type: 'png', w: 40000, h: 40000 });
});

test('the page worker refuses it without decoding it', async () => {
  let decoded = 0;
  const replies = [];
  globalThis.createImageBitmap = async () => { decoded++; throw new Error('should not be decoded'); };
  globalThis.self = { FlatbedScan: S, postMessage: m => replies.push(m) };
  await import('../src/work.js');
  const png = bombPng(20000, 20000);
  globalThis.self.onmessage({ data: { id: 1, cmd: 'detect', key: 1, blob: new Blob([png]) } });
  for (let i = 0; i < 100 && !replies.length; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].ok, false);
  assert.match(replies[0].error, /too large to open: 20000 × 20000 pixels \(400 megapixels; the limit is 100\)/);
  assert.equal(decoded, 0, 'createImageBitmap was never called');
  // a normal photo still goes on to be decoded
  globalThis.self.onmessage({ data: { id: 2, cmd: 'detect', key: 2, blob: new Blob([readFileSync(new URL('fixtures/page.jpg', import.meta.url))]) } });
  for (let i = 0; i < 100 && replies.length < 2; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(decoded, 1);
  assert.match(replies[1].error, /could not be opened/);   // the stand-in decoder above refuses everything
});

test('sizes read from JPEG, PNG, WebP, GIF, BMP and HEIF headers', () => {
  assert.deepEqual(S.pictureSize(new Uint8Array(readFileSync(new URL('fixtures/page.jpg', import.meta.url)))), { type: 'jpeg', w: 1500, h: 260 });
  // tiny real files made with Pillow, 321 x 123
  assert.deepEqual(S.pictureSize(hex('5249464628000000574542505650384c1b0000002f40811e0007d0fffef7bfff0105691b30f56fbf3b11fd4feebfb200')), { type: 'webp', w: 321, h: 123 });   // lossless
  assert.deepEqual(S.pictureSize(hex('5249464682000000574542505650382076000000300c009d012a41017b003e6d')), { type: 'webp', w: 321, h: 123 });   // lossy
  assert.deepEqual(S.pictureSize(hex('52494646b200000057454250565038580a000000100000004001007a0000414c5048150000000107')), { type: 'webp', w: 321, h: 123 });   // extended (alpha)
  assert.deepEqual(S.pictureSize(hex('47494638376141017b00810000ffffff')), { type: 'gif', w: 321, h: 123 });
  assert.deepEqual(S.pictureSize(hex('424d62cf0100000000003600000028000000410100007b000000010018000000')), { type: 'bmp', w: 321, h: 123 });
  // BMP stored top-down (negative height); HEIF with a thumbnail and the full-size image
  const bmp = hex('424d62cf0100000000003600000028000000410100007b000000010018000000'); new DataView(bmp.buffer).setInt32(22, -123, true);
  assert.deepEqual(S.pictureSize(bmp), { type: 'bmp', w: 321, h: 123 });
  const box = (w, h) => { const b = Buffer.alloc(20); b.writeUInt32BE(20); b.write('ispe', 4); b.writeUInt32BE(w, 12); b.writeUInt32BE(h, 16); return b; };
  const heif = new Uint8Array(Buffer.concat([Buffer.from('0000001866747970686569630000000068656963', 'hex'), Buffer.alloc(40), box(320, 240), box(30000, 20000)]));
  assert.deepEqual(S.pictureSize(heif), { type: 'heif', w: 30000, h: 20000 });
  assert.ok(S.tooLarge(heif));
});

test('ordinary pictures pass; damaged or unknown ones are left to the browser', () => {
  assert.equal(S.tooLarge(new Uint8Array(readFileSync(new URL('fixtures/page.jpg', import.meta.url)))), null);
  assert.equal(S.tooLarge(bombPng(8000, 6000)), null, '48 megapixels (a phone camera\'s full resolution) is fine');
  assert.ok(S.tooLarge(bombPng(12000, 9000)), '108 megapixels is not');
  // a JPEG whose frame header says 65535 x 65535, after a large APP1 segment (as phones write EXIF)
  const jpg = new Uint8Array(4 + 65535 + 2 + 19);
  jpg.set([0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF], 0);
  jpg.set([0xFF, 0xC2, 0x00, 0x11, 0x08, 0xFF, 0xFF, 0xFF, 0xFF, 0x03], 4 + 65535);
  assert.deepEqual(S.tooLarge(jpg), { type: 'jpeg', w: 65535, h: 65535 });
  for (const b of [new Uint8Array(0), hex('ffd8'), hex('ffd8ffe100'), hex('ffd8ffda0002'), hex('ffd8ff00'), hex('89504e470d0a1a0a'), hex('52494646'), hex('000000006674797000')]) {
    assert.equal(S.pictureSize(b), null, Buffer.from(b).toString('hex'));
  }
  assert.equal(S.pictureSize(new TextEncoder().encode('%PDF-1.7 not a picture')), null);
});
