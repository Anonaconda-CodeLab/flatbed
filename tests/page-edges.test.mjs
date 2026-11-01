// Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
// Page edges found exactly: a form whose footer is printed a few millimetres from the bottom of the paper must not be
// cut off (detectPage alone, on its 480 px copy, pulled the edges about 2% in and cut through such a footer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/scan.js';
const S = globalThis.FlatbedScan;

// deterministic noise
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const inside = (q, x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = q[i], [xj, yj] = q[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

// A photo of an A4 form (page coordinates 0..1000 x 0..1414) on a dark, speckled worktop. The form has a printed
// border box and, below it, footer text ending 0.7% of the page height (about 2 mm on A4) above the paper's edge.
const PAGE = [[0, 0], [1000, 0], [1000, 1414], [0, 1414]];
function photo(W, H, quad, { table = 45 } = {}) {
  const data = new Uint8ClampedArray(W * H * 4), Hm = S.homography(quad, PAGE);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4; let v;
    if (inside(quad, x + 0.5, y + 0.5)) {
      const d = Hm[6] * x + Hm[7] * y + 1, u = (Hm[0] * x + Hm[1] * y + Hm[2]) / d, t = (Hm[3] * x + Hm[4] * y + Hm[5]) / d;
      const border = (Math.abs(u - 80) < 2 || Math.abs(u - 920) < 2) && t > 120 && t < 1300 || (Math.abs(t - 120) < 2 || Math.abs(t - 1300) < 2) && u > 80 && u < 920;
      const words = t > 160 && t < 1260 && ((t - 160) % 50) < 12 && u > 110 && u < 880 && ((u * 7 + Math.floor(t / 50) * 13) % 97) > 14;
      const footer = t > 1385 && t < 1404 && (u > 70 && u < 260 || u > 800 && u < 930) && (u % 9) > 2;   // the footer line
      v = border || words || footer ? 40 : 232;
      data[o] = v; data[o + 1] = v; data[o + 2] = v * 0.98;
    } else {
      v = table + 30 * rnd() + (rnd() > 0.985 ? 70 : 0);   // a speckled stone worktop
      data[o] = v; data[o + 1] = v; data[o + 2] = v * 1.05;
    }
    data[o + 3] = 255;
  }
  return { w: W, h: H, data };
}
// what the page worker does: find the page on a 480 px copy, then refine it on a 1600 px copy
function findPage(img) {
  const small = S.shrink(img, 480), k = small.w / img.w;
  const r = S.detectPage(small);
  if (!r) return null;
  const mid = S.shrink(img, 1600), k2 = mid.w / img.w, f = k2 / k;
  const fine = S.refineQuad(mid, r.raw.map(([x, y]) => [x * f, y * f]), r.tol * f);
  return { coarse: r.quad.map(([x, y]) => [x / k, y / k]), fine: fine && fine.map(([x, y]) => [x / k2, y / k2]) };
}
// where a point of the photo is on the page (page coordinates)
const toPage = (quad, [x, y]) => { const H = S.homography(quad, PAGE), d = H[6] * x + H[7] * y + 1; return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d]; };

const W = 1500, H = 2000, TRUE = [[160, 150], [1330, 120], [1360, 1790], [140, 1820]];
const img = photo(W, H, TRUE);
const found = findPage(img);

test('the exact edges are found: every corner within a few pixels of the paper\'s, slightly inside', () => {
  assert.ok(found && found.fine, 'page found and refined');
  found.fine.forEach((p, i) => {
    const [u, v] = toPage(TRUE, p), c = PAGE[i];
    const inX = i === 0 || i === 3 ? u - c[0] : c[0] - u, inY = i < 2 ? v - c[1] : c[1] - v;   // how far inside the paper
    assert.ok(inX > -0.5 && inX < 4 && inY > -0.5 && inY < 4, `corner ${i}: ${u.toFixed(1)}, ${v.toFixed(1)} on the page (inside by ${inX.toFixed(1)}, ${inY.toFixed(1)} of 1000)`);
  });
});

test('the footer near the bottom edge is kept (it was cut off before)', () => {
  // the footer's lowest line is at 1404 of 1414 on the page: the page's outline must reach below it everywhere
  const bottom = q => Math.min(toPage(TRUE, q[2])[1], toPage(TRUE, q[3])[1]);
  assert.ok(bottom(found.fine) > 1407, `refined outline reaches ${bottom(found.fine).toFixed(1)} of 1414`);
  assert.ok(bottom(found.coarse) < 1404, `before, the outline stopped at ${bottom(found.coarse).toFixed(1)}, through the footer`);
});

test('no table at the edges of the flattened page', () => {
  const sz = S.outputSize(found.fine, 900), flat = S.warp(img, found.fine, sz.w, sz.h);
  let dark = 0, n = 0;
  for (let x = 0; x < sz.w; x++) for (const y of [0, 1, sz.h - 2, sz.h - 1]) { n++; if (flat.data[(y * sz.w + x) * 4] < 150) dark++; }
  for (let y = 0; y < sz.h; y++) for (const x of [0, 1, sz.w - 2, sz.w - 1]) { n++; if (flat.data[(y * sz.w + x) * 4] < 150) dark++; }
  assert.ok(dark / n < 0.01, `${(100 * dark / n).toFixed(1)}% of the edge pixels are dark`);
});

test('a side without a clear edge: the refinement gives up, so the rough outline is kept', () => {
  // the same photo, but with a white sheet next to the page's right edge, so that side has no edge to find
  const half = photo(W, H, TRUE);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (inside(TRUE, x + 0.5, y + 0.5)) continue;
    const xr = TRUE[1][0] + (TRUE[2][0] - TRUE[1][0]) * y / H;   // the right edge at this height
    if (x > xr - 40) { const o = (y * W + x) * 4; half.data[o] = half.data[o + 1] = 232; half.data[o + 2] = 227; }
  }
  const mid = S.shrink(half, 1600), k = mid.w / W, raw = TRUE.map(([x, y]) => [x * k, y * k]);
  assert.equal(S.refineQuad(mid, raw, 12), null, 'no outline from three sides and a guess');
  assert.ok(S.refineQuad(S.shrink(img, 1600), raw, 12), 'with all four edges clear, it does refine');
});
