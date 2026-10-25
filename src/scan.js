/* Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
   ---------- Flatbed image pipeline ----------
   Finds the page in a photo, flattens it (perspective correction), straightens it, and cleans it up (colour,
   enhanced, grey, black and white). Plain JavaScript on pixel arrays: no DOM, no network, no dependencies, so it runs
   in the page, in a worker and in Node (the tests).

   Images are { w, h, data } where data is a Uint8ClampedArray of RGBA (4 bytes a pixel) or, for "grey" images, a
   Uint8Array/Uint8ClampedArray with one byte a pixel.

   API (all on the global FlatbedScan):
     toGray(img)                       -> grey image
     shrink(img, maxSide)              -> smaller copy (area average), same kind (RGBA or grey)
     detectPage(grey)                  -> { quad: [[x,y] x4 tl,tr,br,bl], score } or null
     outputSize(quad, maxSide)         -> { w, h }  size of the flattened page
     warp(img, quad, w, h)             -> RGBA image of the quad, flattened to w x h
     estimateSkew(grey)                -> the correction in degrees, for rotate(); 0 if level or unsure
     rotate(img, deg)                  -> RGBA image rotated by a small angle, same size, white corners
     rotate90(img, turns)              -> RGBA image turned by 90° steps clockwise
     filter(img, mode, strength)       -> RGBA image; mode 'color' | 'enhanced' | 'grey' | 'bw'; strength -1..1
     flattenGray(img)                  -> grey image with shadows and uneven light removed (used for OCR)
     bilevel(img, strength)            -> { w, h, bits } 1 bit a pixel, 1 = white, rows padded to whole bytes (PDF)
     defaultQuad(w, h)                 -> the whole picture (used when no page edge is found) */
(function (root) {
  'use strict';

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const isGray = img => img.data.length === img.w * img.h;

  // ---------- conversions ----------
  function toGray(img) {
    if (isGray(img)) return img;
    const { w, h, data } = img, out = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
    return { w, h, data: out };
  }
  function grayToRgba(g) {
    const out = new Uint8ClampedArray(g.w * g.h * 4);
    for (let i = 0, j = 0; i < g.data.length; i++, j += 4) { const v = g.data[i]; out[j] = out[j + 1] = out[j + 2] = v; out[j + 3] = 255; }
    return { w: g.w, h: g.h, data: out };
  }

  // area-average downscale (good quality for big reductions); returns the same kind of image it was given
  function shrink(img, maxSide) {
    const { w, h, data } = img, s = Math.min(1, maxSide / Math.max(w, h));
    if (s >= 1) return img;
    const ch = isGray(img) ? 1 : 4;
    const nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
    const out = new Uint8ClampedArray(nw * nh * ch), sum = new Float64Array(nw * ch), cnt = new Float64Array(nw);
    const xs = new Int32Array(w); for (let x = 0; x < w; x++) xs[x] = Math.min(nw - 1, Math.floor(x * nw / w));
    let oy = 0;
    sum.fill(0); cnt.fill(0);
    for (let y = 0; y < h; y++) {
      const ty = Math.min(nh - 1, Math.floor(y * nh / h));
      if (ty !== oy) { flush(oy); oy = ty; }
      const row = y * w * ch;
      for (let x = 0; x < w; x++) {
        const tx = xs[x], p = row + x * ch, q = tx * ch;
        for (let c = 0; c < ch; c++) sum[q + c] += data[p + c];
        cnt[tx]++;
      }
    }
    flush(oy);
    function flush(r) {
      const base = r * nw * ch;
      for (let x = 0; x < nw; x++) { const n = cnt[x] || 1; for (let c = 0; c < ch; c++) out[base + x * ch + c] = sum[x * ch + c] / n; }
      sum.fill(0); cnt.fill(0);
    }
    return { w: nw, h: nh, data: out };
  }

  // separable box blur, run twice (close to a Gaussian); grey images only
  function blur(g, r) {
    const { w, h } = g; let a = Float32Array.from(g.data), b = new Float32Array(w * h);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) {            // horizontal
        let acc = 0; const o = y * w;
        for (let x = -r; x <= r; x++) acc += a[o + clamp(x, 0, w - 1)];
        for (let x = 0; x < w; x++) { b[o + x] = acc / (2 * r + 1); acc += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; }
      }
      for (let x = 0; x < w; x++) {            // vertical
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += b[clamp(y, 0, h - 1) * w + x];
        for (let y = 0; y < h; y++) { a[y * w + x] = acc / (2 * r + 1); acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; }
      }
    }
    return { w, h, data: a };
  }

  // ---------- page detection ----------
  // Canny-style edges -> connected edge groups -> convex hull -> the largest four-cornered shape that the edges
  // actually follow. Works on a small grey copy (about 500 px); the caller scales the corners back up.
  function edges(g) {
    const { w, h } = g, s = blur(g, 2).data, mag = new Float32Array(w * h), dir = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -s[i - w - 1] - 2 * s[i - 1] - s[i + w - 1] + s[i - w + 1] + 2 * s[i + 1] + s[i + w + 1];
      const gy = -s[i - w - 1] - 2 * s[i - w] - s[i - w + 1] + s[i + w - 1] + 2 * s[i + w] + s[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
      const a = Math.atan2(gy, gx) * 180 / Math.PI, t = (a + 180) % 180;
      dir[i] = t < 22.5 || t >= 157.5 ? 0 : t < 67.5 ? 1 : t < 112.5 ? 2 : 3;
    }
    // thresholds from the strongest edges in this picture
    const vals = []; for (let i = 0; i < mag.length; i += 3) if (mag[i] > 4) vals.push(mag[i]);
    vals.sort((a, b) => a - b);
    const hi = Math.max(40, vals.length ? vals[Math.floor(vals.length * 0.9)] : 40), lo = hi * 0.4;
    const nms = new Uint8Array(w * h);   // 0 none, 1 weak, 2 strong
    const off = [[1, 0], [1, 1], [0, 1], [-1, 1]];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, m = mag[i]; if (m < lo) continue;
      const [dx, dy] = off[dir[i]];
      if (m < mag[i + dy * w + dx] || m < mag[i - dy * w - dx]) continue;
      nms[i] = m >= hi ? 2 : 1;
    }
    // hysteresis: weak edges count only when joined to strong ones
    const out = new Uint8Array(w * h), stack = [];
    for (let i = 0; i < nms.length; i++) if (nms[i] === 2 && !out[i]) {
      out[i] = 1; stack.push(i);
      while (stack.length) {
        const p = stack.pop(), px = p % w, py = (p - px) / w;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx; if (!out[q] && nms[q]) { out[q] = 1; stack.push(q); }
        }
      }
    }
    return out;
  }
  function dilate(b, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!b[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = 1;
      }
    }
    return out;
  }
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  function hull(pts) {   // monotone chain, counter-clockwise in y-down coordinates becomes clockwise on screen
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const lower = [], upper = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }
  const triArea = (a, b, c) => Math.abs(cross(a, b, c)) / 2;
  function polyArea(q) { let s = 0; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
  // largest-area quadrilateral with corners on the hull (hull points in order)
  function maxQuad(hp) {
    let k = hp.length; if (k < 4) return null;
    if (k > 48) { const step = k / 48, t = []; for (let i = 0; i < 48; i++) t.push(hp[Math.floor(i * step)]); hp = t; k = 48; }
    let best = null, bestA = -1;
    for (let i = 0; i < k; i++) for (let j = i + 2; j < k; j++) {
      let a1 = -1, p1 = -1, a2 = -1, p2 = -1;
      for (let m = i + 1; m < j; m++) { const a = triArea(hp[i], hp[j], hp[m]); if (a > a1) { a1 = a; p1 = m; } }
      for (let m = j + 1; m < k + i; m++) { const mm = m % k; const a = triArea(hp[i], hp[j], hp[mm]); if (a > a2) { a2 = a; p2 = mm; } }
      if (p1 < 0 || p2 < 0) continue;
      if (a1 + a2 > bestA) { bestA = a1 + a2; best = [hp[i], hp[p1], hp[j], hp[p2]]; }
    }
    return best;
  }
  // order four corners as top-left, top-right, bottom-right, bottom-left
  function order(q) {
    const c = [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4];
    const s = q.slice().sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
    // after sorting by angle (y down): starts near the left going clockwise on screen; pick the top-left as the one with smallest x+y
    let k = 0; for (let i = 1; i < 4; i++) if (s[i][0] + s[i][1] < s[k][0] + s[k][1]) k = i;
    return [s[k], s[(k + 1) % 4], s[(k + 2) % 4], s[(k + 3) % 4]];
  }
  function angleOk(q) {
    for (let i = 0; i < 4; i++) {
      const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
      const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
      const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
      const deg = Math.acos(clamp(cos, -1, 1)) * 180 / Math.PI;
      if (deg < 50 || deg > 130) return false;
    }
    return true;
  }
  // share of the quad's outline that runs along detected edges
  function support(q, e, w, h) {
    let hit = 0, all = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let t = 0; t <= n; t++) {
        const x = Math.round(a[0] + (b[0] - a[0]) * t / n), y = Math.round(a[1] + (b[1] - a[1]) * t / n);
        all++;
        let found = 0;
        for (let dy = -2; dy <= 2 && !found; dy++) for (let dx = -2; dx <= 2 && !found; dx++) {
          const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && e[ny * w + nx]) found = 1;
        }
        hit += found;
      }
    }
    return all ? hit / all : 0;
  }
  function detectPage(img) {
    let g = toGray(img);
    const scale = Math.min(1, 480 / Math.max(g.w, g.h));
    g = shrink(g, 480);
    const { w, h } = g, e = dilate(edges(g), w, h), seen = new Uint8Array(w * h), cand = [];
    const minPix = (w + h) / 3;
    for (let i = 0; i < e.length; i++) {
      if (!e[i] || seen[i]) continue;
      const pts = [], stack = [i]; seen[i] = 1;
      while (stack.length) {
        const p = stack.pop(), px = p % w, py = (p - px) / w; pts.push([px, py]);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx; if (e[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
      if (pts.length >= minPix) cand.push(pts);
    }
    let best = null;
    for (const pts of cand) {
      const hp = hull(pts); const q = maxQuad(hp); if (!q) continue;
      const oq = order(q), area = polyArea(oq) / (w * h);
      if (area < 0.12 || !angleOk(oq)) continue;
      const sup = support(oq, e, w, h);
      if (sup < 0.55) continue;
      const score = area * sup;
      if (!best || score > best.score) best = { quad: oq, score, support: sup, area };
    }
    if (!best) return null;
    // edges are found on the boundary itself: pull the corners in a little so no strip of table is left at the edges
    const cx = best.quad.reduce((a, p) => a + p[0], 0) / 4, cy = best.quad.reduce((a, p) => a + p[1], 0) / 4;
    // (the edge lines were thickened by a pixel to join them up, so the hull sits about 2 px outside the page)
    best.quad = best.quad.map(([x, y]) => { const t = 0.01 + 2.5 / Math.max(1, Math.hypot(cx - x, cy - y)); return [(x + (cx - x) * t) / scale, (y + (cy - y) * t) / scale]; });
    return best;
  }
  const defaultQuad = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];   // no page found: keep the whole picture

  // ---------- perspective correction ----------
  // homography taking the unit rectangle (0..w, 0..h) to the quad; solved as an 8x8 linear system
  function homography(src, dst) {
    const A = [], B = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
    }
    // Gaussian elimination with partial pivoting
    for (let c = 0; c < 8; c++) {
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
      const d = A[c][c]; if (Math.abs(d) < 1e-12) throw new Error('These corners do not make a page');
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = A[r][c] / d; if (!f) continue;
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        B[r] -= f * B[c];
      }
    }
    const hm = B.map((b, i) => b / A[i][i]); hm.push(1);
    return hm;
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function outputSize(q, maxSide) {
    let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const s = maxSide ? Math.min(1, maxSide / Math.max(w, h)) : 1;
    return { w: Math.max(8, Math.round(w * s)), h: Math.max(8, Math.round(h * s)) };
  }
  function warp(img, quad, ow, oh) {
    const src = isGray(img) ? grayToRgba(img) : img, { w, h, data } = src;
    const H = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], quad);
    const out = new Uint8ClampedArray(ow * oh * 4);
    for (let y = 0; y < oh; y++) {
      const yy = y + 0.5;
      for (let x = 0; x < ow; x++) {
        const xx = x + 0.5, d = H[6] * xx + H[7] * yy + 1;
        const sx = (H[0] * xx + H[1] * yy + H[2]) / d - 0.5, sy = (H[3] * xx + H[4] * yy + H[5]) / d - 0.5;
        const o = (y * ow + x) * 4;
        if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > h - 0.5) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255; continue; }
        const x0 = clamp(Math.floor(sx), 0, w - 1), y0 = clamp(Math.floor(sy), 0, h - 1);
        const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
        const fx = clamp(sx - x0, 0, 1), fy = clamp(sy - y0, 0, 1);
        const p00 = (y0 * w + x0) * 4, p10 = (y0 * w + x1) * 4, p01 = (y1 * w + x0) * 4, p11 = (y1 * w + x1) * 4;
        for (let c = 0; c < 3; c++) {
          const top = data[p00 + c] + (data[p10 + c] - data[p00 + c]) * fx, bot = data[p01 + c] + (data[p11 + c] - data[p01 + c]) * fx;
          out[o + c] = top + (bot - top) * fy;
        }
        out[o + 3] = 255;
      }
    }
    return { w: ow, h: oh, data: out };
  }

  // ---------- straightening ----------
  function otsu(hist, n) {
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, t = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = n - wB; if (!wF) break;
      sB += i * hist[i];
      const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = i; }
    }
    return t;
  }
  // projection profile: text lines make the row sums spikiest when the page is level
  function estimateSkew(img) {
    const g = shrink(toGray(img), 900), { w, h, data } = g;
    const hist = new Uint32Array(256); for (let i = 0; i < data.length; i++) hist[data[i]]++;
    const t = otsu(hist, data.length);
    const ink = []; const m = Math.round(Math.min(w, h) * 0.04);   // ignore a thin border (page edges, shadows)
    for (let y = m; y < h - m; y += 1) for (let x = m; x < w - m; x += 1) if (data[y * w + x] < t) ink.push(x - w / 2, y - h / 2);
    const n = ink.length / 2;
    if (n < 200 || n > w * h * 0.35) return 0;   // too little text, or mostly a picture
    const score = deg => {
      const a = deg * Math.PI / 180, s = Math.sin(a), c = Math.cos(a), bins = new Float64Array(h * 2);
      for (let i = 0; i < ink.length; i += 2) { const yy = Math.round(ink[i] * s + ink[i + 1] * c + h); if (yy >= 0 && yy < bins.length) bins[yy]++; }
      let v = 0; for (let i = 0; i < bins.length; i++) v += bins[i] * bins[i];
      return v;
    };
    let best = 0, bestV = score(0); const zero = bestV;
    for (let d = -6; d <= 6.001; d += 0.25) { const v = score(d); if (v > bestV) { bestV = v; best = d; } }
    for (let d = best - 0.25; d <= best + 0.25; d += 0.05) { const v = score(d); if (v > bestV) { bestV = v; best = d; } }
    if (Math.abs(best) < 0.15 || bestV < zero * 1.03) return 0;
    return -Math.round(best * 100) / 100;   // the correction: rotate(img, this) levels the page
  }
  function rotate(img, deg) {
    if (!deg) return isGray(img) ? grayToRgba(img) : img;
    const src = isGray(img) ? grayToRgba(img) : img, { w, h, data } = src, out = new Uint8ClampedArray(w * h * 4);
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), cx = w / 2, cy = h / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const sx = c * dx - s * dy + cx - 0.5, sy = s * dx + c * dy + cy - 0.5;
      const o = (y * w + x) * 4;
      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255; continue; }
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
      const p00 = (y0 * w + x0) * 4, p10 = (y0 * w + x1) * 4, p01 = (y1 * w + x0) * 4, p11 = (y1 * w + x1) * 4;
      for (let k = 0; k < 3; k++) {
        const top = data[p00 + k] + (data[p10 + k] - data[p00 + k]) * fx, bot = data[p01 + k] + (data[p11 + k] - data[p01 + k]) * fx;
        out[o + k] = top + (bot - top) * fy;
      }
      out[o + 3] = 255;
    }
    return { w, h, data: out };
  }
  function rotate90(img, turns) {
    turns = ((turns % 4) + 4) % 4;
    const src = isGray(img) ? grayToRgba(img) : img;
    if (!turns) return src;
    const { w, h, data } = src, nw = turns % 2 ? h : w, nh = turns % 2 ? w : h, out = new Uint32Array(nw * nh), inp = new Uint32Array(data.buffer, data.byteOffset, w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = inp[y * w + x];
      const nx = turns === 1 ? h - 1 - y : turns === 2 ? w - 1 - x : y, ny = turns === 1 ? x : turns === 2 ? h - 1 - y : w - 1 - x;
      out[ny * nw + nx] = v;
    }
    return { w: nw, h: nh, data: new Uint8ClampedArray(out.buffer) };
  }

  // ---------- clean-up ----------
  // Paper brightness map: the page's light level everywhere, found by taking the brightest nearby pixels (text is
  // darker than paper, so it drops out) on a small copy and smoothing it. Dividing by it removes shadows and uneven light.
  function paperMap(g) {
    const small = shrink(g, 96), { w, h } = small, d = small.data, mx = new Float32Array(w * h), r = 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const v = d[yy * w + xx]; if (v > m) m = v; } }
      mx[y * w + x] = m;
    }
    return blur({ w, h, data: mx }, 3);
  }
  function sampleMap(map, x, y, W, H) {   // bilinear lookup of the small map at full-size coordinates
    const fx = clamp((x + 0.5) * map.w / W - 0.5, 0, map.w - 1), fy = clamp((y + 0.5) * map.h / H - 0.5, 0, map.h - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(map.w - 1, x0 + 1), y1 = Math.min(map.h - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    const d = map.data, t = d[y0 * map.w + x0] + (d[y0 * map.w + x1] - d[y0 * map.w + x0]) * ax, b = d[y1 * map.w + x0] + (d[y1 * map.w + x1] - d[y1 * map.w + x0]) * ax;
    return t + (b - t) * ay;
  }
  // per-row lookup of the paper map (one value per pixel), so the divide is cheap
  function paperRow(map, y, W, H, row) { for (let x = 0; x < W; x++) row[x] = Math.max(24, sampleMap(map, x, y, W, H)); return row; }

  function flattenGray(img) {
    const g = toGray(img), { w, h, data } = g, map = paperMap(g), out = new Uint8ClampedArray(w * h), row = new Float32Array(w);
    for (let y = 0; y < h; y++) {
      paperRow(map, y, w, h, row);
      for (let x = 0; x < w; x++) { const i = y * w + x; out[i] = data[i] * 255 / row[x]; }
    }
    return { w, h, data: out };
  }

  function filter(img, mode, strength) {
    strength = clamp(+strength || 0, -1, 1);
    const src = isGray(img) ? grayToRgba(img) : img, { w, h, data } = src;
    if (mode === 'color' || !mode) return src;
    const g = toGray(src), map = paperMap(g), row = new Float32Array(w), out = new Uint8ClampedArray(w * h * 4);
    if (mode === 'enhanced') {
      // white paper, deeper ink, colours kept
      const black = 40 + strength * 30, gain = 255 / (255 - black);
      for (let y = 0; y < h; y++) {
        paperRow(map, y, w, h, row);
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4, k = 255 / row[x];
          for (let c = 0; c < 3; c++) { const v = data[o + c] * k; out[o + c] = (v - black) * gain; }
          out[o + 3] = 255;
        }
      }
      return { w, h, data: out };
    }
    if (mode === 'grey') {
      const black = 30 + strength * 30, gain = 255 / (255 - black);
      for (let y = 0; y < h; y++) {
        paperRow(map, y, w, h, row);
        for (let x = 0; x < w; x++) { const i = y * w + x, o = i * 4, v = (g.data[i] * 255 / row[x] - black) * gain; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255; }
      }
      return { w, h, data: out };
    }
    // black and white
    const b = bilevel(src, strength);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, v = (b.bits[y * b.stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
      out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
    }
    return { w, h, data: out };
  }
  // black and white, 1 bit a pixel (1 = white): flatten the light, then one threshold for the whole page
  function bilevel(img, strength) {
    strength = clamp(+strength || 0, -1, 1);
    const f = flattenGray(img), { w, h, data } = f;
    const hist = new Uint32Array(256); for (let i = 0; i < data.length; i++) hist[data[i]]++;
    const t = clamp(otsu(hist, data.length), 120, 215) + strength * 25;   // stronger = more turns black (bolder text)
    const stride = (w + 7) >> 3, bits = new Uint8Array(stride * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x] > t) bits[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
    return { w, h, stride, bits };
  }

  const api = { toGray, shrink, detectPage, defaultQuad, outputSize, warp, homography, estimateSkew, rotate, rotate90, filter, flattenGray, bilevel, order };
  root.FlatbedScan = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
