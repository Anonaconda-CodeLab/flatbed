// Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
// The image pipeline on synthetic photos: a page at an angle on a busy table, text lines, shadows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/scan.js';
const S = globalThis.FlatbedScan;

// deterministic noise
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const inside = (q, x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = q[i], [xj, yj] = q[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

// a "photo": wood-ish textured background, a white page with dark text lines, mapped through the quad
function photo(w, h, quad, opts = {}) {
  const data = new Uint8ClampedArray(w * h * 4), H = S.homography(quad, [[0, 0], [1000, 0], [1000, 1414], [0, 1414]]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; let v;
    if (inside(quad, x + 0.5, y + 0.5)) {
      const d = H[6] * x + H[7] * y + 1, u = (H[0] * x + H[1] * y + H[2]) / d, t = (H[3] * x + H[4] * y + H[5]) / d;
      const line = t > 120 && t < 1300 && ((t - 120) % 60) < 18 && u > 100 && u < 900 && ((u * 7 + Math.floor(t / 60) * 13) % 97) > 12;
      v = line ? 30 : 235;
      if (opts.shadow) v *= 0.55 + 0.45 * (x / w);   // light falls off to the left
      data[o] = v; data[o + 1] = v; data[o + 2] = v * 0.97;
    } else {
      v = 90 + 40 * Math.sin(y / 9) + 25 * rnd();
      data[o] = v * 0.8; data[o + 1] = v * 0.6; data[o + 2] = v * 0.4;
    }
    data[o + 3] = 255;
  }
  return { w, h, data };
}
const near = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

test('finds a tilted page on a busy background', () => {
  const quad = [[140, 90], [610, 130], [660, 820], [95, 790]];
  const r = S.detectPage(photo(760, 900, quad));
  assert.ok(r, 'page found');
  r.quad.forEach((p, i) => assert.ok(near(p, quad[i], 14), `corner ${i}: ${p} vs ${quad[i]}`));
});

test('finds a page photographed at a strong angle, with uneven light', () => {
  const quad = [[220, 160], [560, 150], [720, 760], [70, 790]];
  const r = S.detectPage(photo(800, 900, quad, { shadow: true }));
  assert.ok(r, 'page found');
  r.quad.forEach((p, i) => assert.ok(near(p, quad[i], 16), `corner ${i}: ${p} vs ${quad[i]}`));
});

test('no page in a picture without one', () => {
  const w = 600, h = 400, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = 100 + 60 * rnd(); data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  assert.equal(S.detectPage({ w, h, data }), null);
});

test('flattening gives an upright page of the right shape', () => {
  const quad = [[140, 90], [610, 130], [660, 820], [95, 790]];
  const img = photo(760, 900, quad), size = S.outputSize(quad, 1000);
  assert.ok(size.h > size.w && Math.max(size.w, size.h) <= 1000, `size ${size.w}x${size.h}`);
  const flat = S.warp(img, quad, size.w, size.h), g = S.toGray(flat);
  // corners of the flattened page are paper (light), the table is gone
  for (const [x, y] of [[5, 5], [size.w - 6, 5], [5, size.h - 6], [size.w - 6, size.h - 6]]) assert.ok(g.data[y * size.w + x] > 180, `corner ${x},${y} is ${g.data[y * size.w + x]}`);
});

test('straightening: a skewed page is measured and fixed', () => {
  const w = 900, h = 1200, data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 150; y < 1050; y += 45) for (let x = 120; x < 780; x++) for (let k = 0; k < 14; k++) {
    if ((x * 3 + y) % 50 < 6) continue;   // gaps between "words"
    const o = ((y + k) * w + x) * 4; data[o] = data[o + 1] = data[o + 2] = 20;
  }
  const level = { w, h, data };
  assert.equal(S.estimateSkew(level), 0, 'a level page is left alone');
  const skewed = S.rotate(level, 3);
  const est = S.estimateSkew(skewed);
  assert.ok(Math.abs(Math.abs(est) - 3) < 0.3, `estimated ${est}`);
  assert.ok(Math.abs(S.estimateSkew(S.rotate(skewed, est))) < 0.3, 'straight after correcting');
});

test('clean-up removes shadows: black and white keeps text, makes paper white', () => {
  const quad = [[0, 0], [400, 0], [400, 566], [0, 566]];
  const img = photo(400, 566, quad, { shadow: true });
  const b = S.bilevel(img, 0);
  const at = (x, y) => (b.bits[y * b.stride + (x >> 3)] >> (7 - (x & 7))) & 1;
  let paperWhite = 0, paper = 0;
  for (let y = 5; y < 40; y++) for (let x = 5; x < 395; x++) { paper++; paperWhite += at(x, y); }   // top margin, across the shadow
  assert.ok(paperWhite / paper > 0.98, `paper white ${paperWhite / paper}`);
  // a text line in the dark (left) half is still black
  let ink = 0; for (let x = 45; x < 70; x++) ink += 1 - at(x, Math.round(566 * (130 / 1414)));
  assert.ok(ink > 10, `text kept in the shadow (${ink})`);
  for (const m of ['color', 'enhanced', 'grey', 'bw']) { const r = S.filter(img, m, 0); assert.equal(r.data.length, 400 * 566 * 4, m); }
});

test('turning by 90° steps', () => {
  const img = { w: 3, h: 2, data: new Uint8ClampedArray([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255]) };
  const r = S.rotate90(img, 1);
  assert.equal(r.w, 2); assert.equal(r.h, 3);
  assert.deepEqual([...r.data].filter((_, i) => i % 4 === 0), [4, 1, 5, 2, 6, 3]);
  assert.deepEqual([...S.rotate90(img, 4).data], [...img.data]);
});
