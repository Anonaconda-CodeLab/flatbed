/* Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
   ---------- Flatbed workers, from the page's side ----------
   Starts the two workers from code that is already in the page (a blob: address, no download) and talks to them.
     FlatbedWork  - finding pages and making the flattened, cleaned-up images (work.js)
     FlatbedOcr   - text recognition (ocr-engine.js); its engine and language files are unpacked from the page the
                    first time text is read, and the worker is stopped again afterwards to free the memory. */
const FlatbedWorkers = (() => {
  'use strict';
  function client(srcId) {
    let w = null, seq = 0;
    const wait = new Map();
    function start() {
      if (w) return w;
      const url = URL.createObjectURL(new Blob([document.getElementById(srcId).textContent], { type: 'text/javascript' }));
      w = new Worker(url);
      w.onmessage = e => { const m = e.data || {}, p = wait.get(m.id); if (!p) return; wait.delete(m.id); m.ok ? p.res(m.result) : p.rej(new Error(m.error)); };
      w.onerror = e => { e.preventDefault(); fail(new Error('The worker stopped: ' + (e.message || 'unknown error'))); };
      return w;
    }
    function fail(err) { for (const p of wait.values()) p.rej(err); wait.clear(); if (w) { w.terminate(); w = null; } }
    return {
      call(cmd, data, transfer) {
        return new Promise((res, rej) => { const id = ++seq; wait.set(id, { res, rej }); start().postMessage(Object.assign({ id, cmd }, data), transfer || []); });
      },
      stop() { fail(new Error('stopped')); },
      get running() { return !!w; }
    };
  }

  // ---------- page work ----------
  const work = client('srcWork');
  const FlatbedWork = {
    detect: (key, blob) => work.call('detect', { key, blob }),
    render: (key, blob, o) => work.call('render', Object.assign({ key, blob }, o)),
    forget: key => work.call('forget', { key }).catch(() => {})
  };

  // ---------- text recognition ----------
  const ocr = client('srcOcr');
  let ready = null;
  const loaded = new Set();
  const bytes = id => { const s = atob(document.getElementById(id).textContent.trim()), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const gunzip = async u => new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  // a tiny WebAssembly module using SIMD: the engine build needs it (Chrome 91+, Safari 16.4+, Firefox 89+)
  const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
  const FlatbedOcr = {
    supported() {
      try { return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD) && typeof DecompressionStream === 'function' && typeof Worker === 'function'; }
      catch (e) { return false; }
    },
    async recognize(pgm, langs) {
      if (!ready) ready = (async () => { const wasm = await gunzip(bytes('binWasm')); await ocr.call('init', { wasm }, [wasm.buffer]); })();
      try { await ready; } catch (e) { ready = null; throw e; }
      for (const l of langs) if (!loaded.has(l)) {
        const data = await gunzip(bytes('binLang-' + l));
        await ocr.call('lang', { name: l, data }, [data.buffer]);
        loaded.add(l);
      }
      return ocr.call('recognize', { image: pgm, langs }, [pgm.buffer]);
    },
    stop() { ocr.stop(); ready = null; loaded.clear(); }
  };
  return { FlatbedWork, FlatbedOcr };
})();
const { FlatbedWork, FlatbedOcr } = FlatbedWorkers;
