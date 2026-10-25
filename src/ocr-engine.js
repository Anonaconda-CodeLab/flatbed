/* Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
   ---------- Flatbed text recognition (runs inside a worker) ----------
   Drives the Tesseract engine (tesseract.js-core, compiled to WebAssembly) directly. Everything it needs is handed
   to it: the engine's WebAssembly code and the language files come from the page itself, so nothing is downloaded.
   In the app this file is placed after the engine's own script and run as a worker; the tests call createEngine()
   in Node.

   Messages (each with an id; the reply carries the same id):
     { cmd: 'init', wasm }                     -> {}                          wasm = the engine's .wasm bytes
     { cmd: 'lang', name, data }               -> {}                          a .traineddata file
     { cmd: 'recognize', image, langs }        -> { text, words, w, h }       image = grey PGM (P5) bytes
   words: [{ text, x, y, w, h, conf, line }] in image pixels; line numbers group the words of one text line. */
(function (root) {
  'use strict';

  function createEngine(Core) {
    let M = null, api = null, loaded = '';
    const have = new Set();
    return {
      async init(wasm) {
        if (M) return;
        M = await Core({ wasmBinary: wasm, print: () => {}, printErr: () => {} });
      },
      addLang(name, data) {
        if (!/^[a-z_]{3,10}$/.test(name)) throw new Error('bad language name');
        M.FS.writeFile(name + '.traineddata', data);
        have.add(name);
      },
      recognize(image, langs) {
        const key = langs.join('+');
        for (const l of langs) if (!have.has(l)) throw new Error('language not loaded: ' + l);
        if (key !== loaded) {
          if (api) { api.End(); api.delete && api.delete(); }
          api = new M.TessBaseAPI();
          if (api.Init(null, key, 1)) { api = null; loaded = ''; throw new Error('could not start text recognition'); }
          loaded = key;
        }
        M.FS.writeFile('/input', image);
        api.SetVariable('user_defined_dpi', '300');
        if (api.SetImageFile(1, 0) === 1) throw new Error('could not read the page image');
        api.Recognize(null);
        const text = api.GetUTF8Text() || '';
        const tsv = api.GetTSVText(0) || '';
        api.Clear();
        try { M.FS.unlink('/input'); } catch (e) { /* already gone */ }
        const words = [];
        let w = 0, h = 0;
        const lineIds = new Map();
        for (const row of tsv.split('\n')) {
          const c = row.split('\t');
          if (c.length < 12) continue;
          const level = +c[0];
          if (level === 1) { w = +c[8]; h = +c[9]; continue; }
          if (level !== 5) continue;
          const t = c.slice(11).join('\t').trim(), conf = +c[10];
          if (!t || conf < 0) continue;
          const lk = c[2] + '.' + c[3] + '.' + c[4];
          if (!lineIds.has(lk)) lineIds.set(lk, lineIds.size);
          words.push({ text: t, x: +c[6], y: +c[7], w: +c[8], h: +c[9], conf: Math.round(conf), line: lineIds.get(lk), par: c[2] + '.' + c[3] });
        }
        void text;
        return Object.assign(tidy(words), { w, h });
      }
    };
  }

  // ---------- tidying the result ----------
  // 1. A "line" lying entirely inside a taller line beside it is not text of its own: Thai tone marks and vowels above
  //    a large heading can be read as a line of stray symbols. It is dropped.
  // 2. Thai is written without spaces between words, but the engine can return it in small pieces. Neighbouring pieces
  //    on a line are joined when both sides are Thai, so copied text has no stray spaces.
  //    The engine's spelling of the Thai vowel sara am is also normalised.
  // 3. The plain text is rebuilt from the words that are kept, so it matches the PDF's text layer exactly.
  const THAI = /[\u0E00-\u0E7F]/;
  function tidy(words) {
    const lines = new Map();
    for (const w of words) {
      const l = lines.get(w.line) || { top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity };
      l.top = Math.min(l.top, w.y); l.bottom = Math.max(l.bottom, w.y + w.h); l.left = Math.min(l.left, w.x); l.right = Math.max(l.right, w.x + w.w);
      lines.set(w.line, l);
    }
    const drop = new Set();
    for (const [id, a] of lines) for (const [id2, b] of lines) {
      if (id === id2 || drop.has(id2)) continue;
      const ha = a.bottom - a.top, hb = b.bottom - b.top;
      if (hb <= ha * 1.2) continue;   // only a clearly taller line can swallow another
      const vov = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top), hov = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (vov >= ha * 0.8 && hov > 0) { drop.add(id); break; }
    }
    const kept = [];
    for (const w of words) {
      if (drop.has(w.line)) continue;
      const prev = kept[kept.length - 1];
      if (prev && prev.line === w.line && THAI.test(prev.text.slice(-1)) && THAI.test(w.text[0])) {
        const right = Math.max(prev.x + prev.w, w.x + w.w), bottom = Math.max(prev.y + prev.h, w.y + w.h);
        prev.text += w.text; prev.x = Math.min(prev.x, w.x); prev.y = Math.min(prev.y, w.y);
        prev.w = right - prev.x; prev.h = bottom - prev.y; prev.conf = Math.min(prev.conf, w.conf);
        continue;
      }
      kept.push(Object.assign({}, w));
    }
    // the engine writes Thai sara am (ำ) as nikhahit + sara aa; the single character is what people type and search for
    for (const w of kept) w.text = w.text.replace(/\u0E4D\u0E32/g, '\u0E33');
    // text: words joined by spaces, lines by line breaks, paragraphs by a blank line
    let text = '';
    for (let i = 0; i < kept.length; i++) {
      const w = kept[i], prev = kept[i - 1];
      if (prev) text += prev.line === w.line ? ' ' : prev.par === w.par ? '\n' : '\n\n';
      text += w.text;
    }
    return { text, words: kept };
  }

  root.FlatbedOcrEngine = { createEngine, tidy };
  if (typeof module === 'object' && module.exports) module.exports = { createEngine, tidy };

  // inside a worker: answer the page's messages one at a time
  if (typeof importScripts === 'function' && typeof root.TesseractCore === 'function') {
    const eng = createEngine(root.TesseractCore);
    let chain = Promise.resolve();
    root.onmessage = e => {
      const m = e.data || {};
      chain = chain.then(async () => {
        try {
          let r = {};
          if (m.cmd === 'init') await eng.init(m.wasm);
          else if (m.cmd === 'lang') eng.addLang(m.name, m.data);
          else if (m.cmd === 'recognize') r = eng.recognize(m.image, m.langs);
          else throw new Error('unknown command');
          root.postMessage({ id: m.id, ok: true, result: r });
        } catch (err) {
          root.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
        }
      });
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
