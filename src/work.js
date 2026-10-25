/* Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
   ---------- Flatbed page worker ----------
   Runs after scan.js inside a worker, so finding, flattening and cleaning up a page never freezes the screen.
   Photos are decoded here (with their rotation applied); the original photo file is only ever read, never sent on:
   every picture that leaves this worker is drawn afresh, so it carries none of the photo's hidden data.

   Messages (each with an id; the reply carries the same id):
     { cmd: 'detect', key, blob }  -> { w, h, quad }            quad null when no page edge was found
     { cmd: 'render', key, blob, quad, turns, mode, strength, maxSide, skew, out, quality }
         out 'jpeg' -> { w, h, skew, blob }   'bits' -> { w, h, skew, stride, bits }   'pgm' -> { w, h, skew, pgm }
         skew: a number to use, or 'auto' to measure it (the reply says what was used)
     { cmd: 'forget', key }        -> {}                        frees the decoded photo */
(function () {
  'use strict';
  const S = self.FlatbedScan, cache = new Map();

  async function bitmap(key, blob) {
    if (cache.has(key)) { const b = cache.get(key); cache.delete(key); cache.set(key, b); return b; }
    let b;
    try { b = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch (e) { throw new Error('This picture could not be opened. Photos in HEIC format need converting to JPEG first.'); }
    cache.set(key, b);
    while (cache.size > 2) { const k = cache.keys().next().value; cache.get(k).close(); cache.delete(k); }
    return b;
  }
  // pixels of part of the photo (sx, sy, sw, sh), scaled by k
  function pixels(bmp, k, sx = 0, sy = 0, sw = bmp.width, sh = bmp.height) {
    const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    x.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    return { w, h, data: x.getImageData(0, 0, w, h).data };
  }
  const longEdge = q => Math.max(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1]),
    Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]), Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]));

  async function detect({ key, blob }) {
    const bmp = await bitmap(key, blob), k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
    const r = S.detectPage(pixels(bmp, k));
    return { w: bmp.width, h: bmp.height, quad: r ? r.quad.map(([x, y]) => [x / k, y / k]) : null };
  }

  async function render(m) {
    const bmp = await bitmap(m.key, m.blob), q = m.quad;
    const size = S.outputSize(q, m.maxSide);
    // read only the part of the photo the page covers, at about the resolution the result needs
    const bx = Math.max(0, Math.floor(Math.min(...q.map(p => p[0])))), by = Math.max(0, Math.floor(Math.min(...q.map(p => p[1]))));
    const bw = Math.min(bmp.width, Math.ceil(Math.max(...q.map(p => p[0])))) - bx, bh = Math.min(bmp.height, Math.ceil(Math.max(...q.map(p => p[1])))) - by;
    const k = Math.min(1, 1.25 * Math.max(size.w, size.h) / longEdge(q));
    const src = pixels(bmp, k, bx, by, Math.max(1, bw), Math.max(1, bh));
    let img = S.warp(src, q.map(([x, y]) => [(x - bx) * k, (y - by) * k]), size.w, size.h);
    let skew = m.skew === 'auto' ? S.estimateSkew(img) : +m.skew || 0;
    if (skew) img = S.rotate(img, skew);
    img = S.rotate90(img, m.turns || 0);
    const base = { w: img.w, h: img.h, skew };
    if (m.out === 'pgm') {
      const g = S.flattenGray(img), head = new TextEncoder().encode(`P5\n${g.w} ${g.h}\n255\n`);
      const pgm = new Uint8Array(head.length + g.data.length); pgm.set(head); pgm.set(g.data, head.length);
      return [Object.assign(base, { pgm }), [pgm.buffer]];
    }
    if (m.out === 'bits') {
      const b = S.bilevel(img, m.strength);
      return [Object.assign(base, { stride: b.stride, bits: b.bits }), [b.bits.buffer]];
    }
    img = S.filter(img, m.mode, m.strength);
    const c = new OffscreenCanvas(img.w, img.h);
    c.getContext('2d').putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: m.quality || 0.85 });
    return [Object.assign(base, { blob }), []];
  }

  let chain = Promise.resolve();
  self.onmessage = e => {
    const m = e.data || {};
    chain = chain.then(async () => {
      try {
        let r = [{}, []];
        if (m.cmd === 'detect') r = [await detect(m), []];
        else if (m.cmd === 'render') r = await render(m);
        else if (m.cmd === 'forget') { const b = cache.get(m.key); if (b) { b.close(); cache.delete(m.key); } }
        else throw new Error('unknown command');
        self.postMessage({ id: m.id, ok: true, result: r[0] }, r[1]);
      } catch (err) {
        self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
      }
    });
  };
})();
