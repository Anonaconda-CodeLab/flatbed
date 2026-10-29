// Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
// Light text on a dark page (a black card, a slide, a dark-mode screen): found, cleaned up as dark-on-light and turned
// back, so it keeps its look. Ordinary pages, including dim ones and ones with a large dark photo, are left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/scan.js';
const S = globalThis.FlatbedScan;

// a flattened page, 700 x 990: rows of "words" on paper, as RGBA. paper and ink are grey levels; light(x, y) is a
// brightness factor (uneven light); box: a filled rectangle [x0, y0, x1, y1, level] drawn over the text (a photo)
function page({ paper, ink, light = () => 1, box = null, W = 700, H = 990 }) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, t = y - 100, u = x - 70;
    const word = t > 0 && t < 800 && (t % 60) < 20 && u > 0 && u < 560 && ((u * 7 + Math.floor(t / 60) * 13) % 97) > 12 && (u % 23) > 3;
    let v = word ? ink : paper;
    if (box && x >= box[0] && x < box[2] && y >= box[1] && y < box[3]) v = box[4] + 30 * Math.sin(x / 7) * Math.cos(y / 11);   // a photo: varied tones
    v *= light(x, y);
    data[o] = v; data[o + 1] = v; data[o + 2] = v * 0.97; data[o + 3] = 255;
  }
  return { w: W, h: H, data };
}
const falloff = x => 0.6 + 0.4 * (x / 700);   // light falls off to the left
// grey levels of the finished page at the gaps between lines (paper) and inside the words (text), right half and left
function measure(r) {
  const at = (x, y) => r.rgba ? r.rgba[(y * r.w + x) * 4] : (r.bits[y * r.stride + (x >> 3)] >> (7 - (x & 7)) & 1) * 255;
  const paper = [], text = [];
  for (let y = 130; y < 880; y += 3) for (let x = 90; x < 600; x += 3) {
    const t = y - 100, u = x - 70;
    if ((t % 60) > 30 && (t % 60) < 55) paper.push(at(x, y));
    if ((t % 60) > 5 && (t % 60) < 15 && ((u * 7 + Math.floor(t / 60) * 13) % 97) > 16 && (u % 23) > 6 && (u % 23) < 21) text.push(at(x, y));
  }
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length, sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
  return { paper: mean(paper), paperSd: sd(paper), text: mean(text) };
}

test('light text on a dark page is recognised as such; ordinary pages are not', () => {
  assert.equal(S.lightOnDark(page({ paper: 22, ink: 235 })), true, 'white on black');
  assert.equal(S.lightOnDark(page({ paper: 22, ink: 235, light: falloff })), true, 'white on black, uneven light');
  assert.equal(S.lightOnDark(page({ paper: 40, ink: 200, light: (x, y) => 0.7 + 0.3 * (y / 990) })), true, 'grey on dark grey');
  assert.equal(S.lightOnDark(page({ paper: 235, ink: 30 })), false, 'black on white');
  assert.equal(S.lightOnDark(page({ paper: 235, ink: 30, light: falloff })), false, 'black on white, uneven light');
  assert.equal(S.lightOnDark(page({ paper: 90, ink: 20 })), false, 'a dim photo of an ordinary page');
  assert.equal(S.lightOnDark(page({ paper: 235, ink: 30, box: [40, 60, 660, 900, 35] })), false, 'a large dark photo with white margins');
  assert.equal(S.lightOnDark(page({ paper: 30, ink: 30 })), false, 'all one tone');
  assert.equal(S.lightOnDark(page({ paper: 50, ink: 80 })), false, 'too little contrast to tell');
  // the page's outermost edge still showing a dark table: still an ordinary page
  const edged = page({ paper: 235, ink: 30 });
  for (let y = 0; y < 990; y++) for (let x = 0; x < 700; x++) if (x < 14 || y < 14 || x >= 686 || y >= 976) edged.data.fill(25, (y * 700 + x) * 4, (y * 700 + x) * 4 + 3);
  assert.equal(S.lightOnDark(edged), false, 'dark table at the very edge');
});

test('Enhanced and Grey: an even black page with white text, not grey stripes and outlined letters', () => {
  const dark = page({ paper: 22, ink: 235, light: falloff });
  for (const mode of ['enhanced', 'grey']) {
    const r = S.finishPage(dark, { skew: 0, mode });
    assert.equal(r.inverted, true);
    const m = measure(r);
    assert.ok(m.paper < 20 && m.paperSd < 8, `${mode}: the page stays black and even (${m.paper.toFixed(0)} ± ${m.paperSd.toFixed(0)})`);
    assert.ok(m.text > 170, `${mode}: the text stays light (${m.text.toFixed(0)})`);
    // what it did before: the page worked on as if the letters were the paper
    const old = measure({ w: 700, h: 990, rgba: S.filter(dark, mode, 0).data });
    assert.ok(old.paper > 80, `${mode}: before, the black page came out grey (${old.paper.toFixed(0)})`);
  }
});

test('Black and white: white text on black, kept', () => {
  const r = S.finishPage(page({ paper: 22, ink: 235, light: falloff }), { skew: 0, mode: 'bw', out: 'bits' });
  const m = measure(r);
  assert.ok(m.paper < 5, `page black (${m.paper.toFixed(0)})`);
  assert.ok(m.text > 230, `text white (${m.text.toFixed(0)})`);
});

test('Original keeps the photo\'s own tones; text recognition gets dark text on light', () => {
  const dark = page({ paper: 22, ink: 235 });
  const orig = S.finishPage(dark, { skew: 0, mode: 'color' });
  assert.deepEqual(orig.rgba, dark.data);
  const ocr = S.finishPage(dark, { skew: 0, out: 'pgm' });
  const m = measure({ w: ocr.w, h: ocr.h, rgba: Uint8ClampedArray.from({ length: ocr.grey.length * 4 }, (_, i) => ocr.grey[i >> 2]) });
  assert.ok(m.paper > 230 && m.text < 60, `dark text on light for the recognition (${m.paper.toFixed(0)} / ${m.text.toFixed(0)})`);
});

test('a tilted dark page is straightened, with black corners', () => {
  const tilted = S.rotate(page({ paper: 22, ink: 235 }), 2.5);
  for (let i = 0; i < tilted.data.length; i++) if (tilted.data[i] === 255 && (i & 3) !== 3) tilted.data[i] = 22;   // rotate() leaves white corners; a photo has the page there
  const r = S.finishPage(tilted, { skew: 'auto', mode: 'enhanced' });
  assert.ok(Math.abs(r.skew + 2.5) < 0.2, `levelled (${r.skew})`);
  assert.ok(r.rgba[0] < 30 && r.rgba[(r.w * r.h - 1) * 4] < 30, 'corners black, like the page');
});

test('an ordinary page goes through exactly as before', () => {
  const light = page({ paper: 235, ink: 30, light: falloff });
  const r = S.finishPage(light, { skew: 0, mode: 'enhanced' });
  assert.equal(r.inverted, false);
  assert.deepEqual(r.rgba, S.filter(light, 'enhanced', 0).data);
  const m = measure(r);
  assert.ok(m.paper > 240 && m.text < 40, `white paper, black text (${m.paper.toFixed(0)} / ${m.text.toFixed(0)})`);
});
