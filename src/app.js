/* Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
   ---------- Flatbed app ----------
   Take or import photos -> each page is found, flattened, straightened and cleaned up (work.js, in a worker) ->
   adjust any page -> "Make PDF": the text is read (ocr-engine.js, in a worker), the PDF is put together (pdf.js),
   cleaned and checked (clean.js, shared with Unmarked), then saved or shared.
   Nothing leaves the device, and nothing is kept: the pages live in memory until the app is closed. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const C = window.UnmarkedClean, PDF = window.PDFLib, P = window.FlatbedPdf;
  const MAX_PAGES = 60, MAX_BYTES = 60 * 1024 * 1024;
  const THUMB = 900, EXPORT = 3000;   // longest side in pixels: page previews, and the PDF (about 250 dpi on A4)
  const state = { pages: [], seq: 0, edit: null, result: null, making: false };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const size = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

  // ---------- screens ----------
  function show(id) {
    for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== id;
    document.body.dataset.screen = id;
    if (id !== 'scrCamera') window.scrollTo(0, 0);
  }
  $('btnAbout').onclick = () => { if (!state.making) show('scrAbout'); };
  $('btnHome').onclick = () => { if (!state.making) { closeEdit(false); show('scrHome'); } };
  $('btnAboutBack').onclick = () => show('scrHome');
  $('btnHelp').onclick = () => show('scrHelp');
  $('btnHelp2').onclick = () => show('scrHelp');
  $('btnHelpBack').onclick = () => show('scrAbout');
  window.flatbedBack = () => {   // Android Back button: go back inside the app; on the home screen, let Android handle it
    const scr = document.body.dataset.screen || 'scrHome';
    if (scr === 'scrHome') return false;
    if (scr === 'scrCamera') closeCamera();
    else if (scr === 'scrEdit') closeEdit(true);
    else if (scr === 'scrExport') { if (!state.making) leaveExport(); }
    else show(scr === 'scrHelp' ? 'scrAbout' : 'scrHome');
    return true;
  };
  let toastTimer = 0;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
  }

  // ---------- pages ----------
  // a page: the photo (kept in memory only, never saved or sent as it is), the page's corners in it, and the look
  const skewFor = pg => pg.straighten ? (typeof pg.skew === 'number' ? pg.skew : 'auto') : 0;
  const look = (pg, extra) => Object.assign({ quad: pg.quad, turns: pg.turns, mode: pg.mode, strength: pg.strength, skew: skewFor(pg) }, extra);
  async function refreshThumb(pg) {
    pg.busy = true; renderPages();
    try {
      const r = await FlatbedWork.render(pg.id, pg.blob, look(pg, { maxSide: THUMB, out: 'jpeg', quality: 0.8 }));
      if (pg.straighten) pg.skew = r.skew;
      if (pg.thumb) URL.revokeObjectURL(pg.thumb);
      pg.thumb = URL.createObjectURL(r.blob);
    } catch (e) { toast('Could not prepare a page: ' + (e && e.message || e)); }
    pg.busy = false; renderPages();
  }

  let adding = Promise.resolve();
  function addPhotos(list, source) {
    list = Array.from(list || []);
    if (!list.length) return adding;
    adding = adding.then(async () => {
      let skipped = 0;
      for (const it of list) {
        if (state.pages.length >= MAX_PAGES) { skipped++; continue; }
        const blob = it instanceof Blob ? it : new Blob([it.bytes], { type: it.mime || 'image/jpeg' });
        if (blob.size > MAX_BYTES) { toast(`A photo is too large (over ${size(MAX_BYTES)}).`); continue; }
        if (state.result) clearResult();
        const pg = { id: ++state.seq, blob, source, w: 0, h: 0, quad: null, found: false, turns: 0, mode: 'enhanced', strength: 0, straighten: true, skew: 'auto', thumb: '', busy: true, findings: [] };
        state.pages.push(pg); renderPages();
        try {
          // what the photo itself carries (location, phone, date...): listed on the PDF screen, never copied into the PDF
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const ins = await C.inspect(bytes, {});
          pg.findings = (ins.findings || []).filter(f => f.keep !== 'always');
          const d = await FlatbedWork.detect(pg.id, blob);
          pg.w = d.w; pg.h = d.h; pg.found = !!d.quad;
          pg.quad = d.quad || FlatbedScan.defaultQuad(d.w, d.h);
        } catch (e) {
          state.pages = state.pages.filter(x => x !== pg); renderPages();
          toast(e && e.message || 'This picture could not be opened.');
          continue;
        }
        await refreshThumb(pg);
        if (!pg.found) toast(`Page ${state.pages.indexOf(pg) + 1}: no page edge found, so the whole picture is used. Tap the page to set its corners.`);
      }
      if (skipped) toast(`${plural(skipped, 'photo')} not added: ${MAX_PAGES} pages is the limit.`);
    });
    return adding;
  }

  function removePage(pg) {
    state.pages = state.pages.filter(x => x !== pg);
    if (pg.thumb) URL.revokeObjectURL(pg.thumb);
    FlatbedWork.forget(pg.id);
    if (state.result) clearResult();
    renderPages();
  }
  function movePage(pg, d) {
    const i = state.pages.indexOf(pg), j = i + d;
    if (j < 0 || j >= state.pages.length) return;
    [state.pages[i], state.pages[j]] = [state.pages[j], state.pages[i]];
    if (state.result) clearResult();
    renderPages();
  }

  const items = new Map();   // page id -> its card
  function renderPages() {
    const list = $('pages');
    for (const [id, li] of items) if (!state.pages.some(p => p.id === id)) { li.remove(); items.delete(id); }
    state.pages.forEach((pg, i) => {
      let li = items.get(pg.id);
      if (!li) {
        li = $('tplPage').content.firstElementChild.cloneNode(true);
        li.querySelector('.page-thumb').onclick = () => { if (!pg.busy) openEdit(pg); };
        li.querySelector('[data-a="left"]').onclick = () => movePage(pg, -1);
        li.querySelector('[data-a="right"]').onclick = () => movePage(pg, 1);
        items.set(pg.id, li);
      }
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
      const img = li.querySelector('img');
      if (pg.thumb && img.getAttribute('src') !== pg.thumb) img.src = pg.thumb;
      img.hidden = !pg.thumb;
      li.querySelector('.busy-veil').hidden = !pg.busy;
      li.querySelector('.page-n').textContent = String(i + 1);
      li.querySelector('.page-thumb').setAttribute('aria-label', `Edit page ${i + 1}`);
      li.querySelector('[data-a="left"]').disabled = i === 0;
      li.querySelector('[data-a="right"]').disabled = i === state.pages.length - 1;
    });
    updateHome();
  }
  function updateHome() {
    const n = state.pages.length, any = n > 0, busy = state.pages.some(p => p.busy);
    $('intro').hidden = any; $('uses').hidden = any;
    document.querySelector('.add-row').classList.toggle('compact', any);
    $('pagesWrap').hidden = !any; $('actions').hidden = !any;
    $('pagesTitle').textContent = `Pages (${n})`;
    $('btnExport').disabled = !any || busy;
    $('btnExportLbl').textContent = n > 1 ? `Make PDF (${n} pages)` : 'Make PDF';
    $('exportHint').textContent = busy ? 'Preparing pages…' : any ? 'Add more pages, reorder them with the arrows, or tap one to adjust it.' : '';
    $('camCount').textContent = String(n);
  }

  // ---------- importing ----------
  $('fileInput').addEventListener('change', e => { addPhotos(e.target.files, 'import'); e.target.value = ''; });
  $('camInput').addEventListener('change', e => { addPhotos(e.target.files, 'camera'); e.target.value = ''; });
  if (NATIVE) $('fileInput').addEventListener('click', async e => {
    e.preventDefault();
    try { const got = await FlatbedNative.pickFiles(); addPhotos(got, 'import'); }
    catch (err) { toast('Could not open the photos: ' + (err && err.message || err)); }
  });
  document.addEventListener('dragover', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', e => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    if (state.making) return;
    show('scrHome'); addPhotos(Array.from(e.dataTransfer.files).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name)), 'import');
  });

  // ---------- camera ----------
  // Web app: a live view with the page outlined, photos taken one after another. Android app: the phone's own camera
  // app (Flatbed itself has no camera permission). If the browser has no camera access, its own photo picker is used.
  let cam = null;
  $('btnCamera').onclick = async () => {
    if (NATIVE) {
      try { const got = await FlatbedNative.takePhoto(); addPhotos(got, 'camera'); }
      catch (err) { toast('Could not open the camera: ' + (err && err.message || err)); }
      return;
    }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { $('camInput').click(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 3264 }, height: { ideal: 2448 } } });
      openCamera(stream);
    } catch (err) {
      if (err && err.name === 'NotAllowedError') toast('Camera access was not allowed, so your phone\'s camera will open instead.');
      $('camInput').click();
    }
  };
  function openCamera(stream) {
    const v = $('camVideo');
    v.srcObject = stream;
    cam = { stream, timer: 0, quad: null, small: document.createElement('canvas') };
    show('scrCamera');
    v.play().catch(() => {});
    const tick = () => {
      if (!cam) return;
      try { outline(); } catch (e) { /* a frame that isn't ready yet */ }
      cam.timer = setTimeout(tick, 300);
    };
    tick();
  }
  // find the page in the live view a few times a second and draw its outline
  function outline() {
    const v = $('camVideo'), o = $('camOverlay');
    if (!v.videoWidth) return;
    const k = Math.min(1, 360 / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k), c = cam.small;
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(v, 0, 0, w, h);
    const r = FlatbedScan.detectPage({ w, h, data: x.getImageData(0, 0, w, h).data });
    const rect = o.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    o.width = Math.round(rect.width * dpr); o.height = Math.round(rect.height * dpr);
    const g = o.getContext('2d'); g.clearRect(0, 0, o.width, o.height);
    $('camTip').textContent = r ? 'Page found. Hold still and take the photo.' : 'Hold the phone above the page, in good light.';
    if (!r) return;
    const s = Math.min(o.width / w, o.height / h), ox = (o.width - w * s) / 2, oy = (o.height - h * s) / 2;
    g.beginPath(); r.quad.forEach(([px, py], i) => g[i ? 'lineTo' : 'moveTo'](ox + px * s, oy + py * s)); g.closePath();
    g.fillStyle = 'rgba(240,168,104,.18)'; g.fill();
    g.lineWidth = 3 * dpr; g.strokeStyle = '#f0a868'; g.stroke();
  }
  $('btnShutter').onclick = async () => {
    if (!cam) return;
    const v = $('camVideo'), btn = $('btnShutter');
    btn.disabled = true;
    try {
      let blob = null;
      const track = cam.stream.getVideoTracks()[0];
      if (window.ImageCapture && track) { try { blob = await new ImageCapture(track).takePhoto(); } catch (e) { blob = null; } }
      if (!blob) {   // fall back to the live picture at full size
        const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
        blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
      }
      if (blob) { addPhotos([blob], 'camera'); $('camCount').textContent = String(state.pages.length + 1); }
    } catch (e) { toast('Could not take the photo: ' + (e && e.message || e)); }
    setTimeout(() => { btn.disabled = false; }, 400);
  };
  function closeCamera() {
    if (cam) { clearTimeout(cam.timer); for (const t of cam.stream.getTracks()) t.stop(); cam = null; }
    $('camVideo').srcObject = null;
    show('scrHome');
  }
  $('btnCamCancel').onclick = closeCamera;

  // ---------- editing a page ----------
  const MODES = { color: '', enhanced: 'Contrast', grey: 'Contrast', bw: 'Text darkness' };
  function openEdit(pg) {
    const d = { pg, quad: pg.quad.map(p => p.slice()), turns: pg.turns, mode: pg.mode, strength: pg.strength, straighten: pg.straighten, skew: pg.skew, url: URL.createObjectURL(pg.blob), token: 0 };
    state.edit = d;
    $('editTitle').textContent = `Page ${state.pages.indexOf(pg) + 1}`;
    $('cropImg').src = d.url;
    $('optStraighten').checked = d.straighten;
    $('strength').value = d.strength;
    show('scrEdit');
    tab(pg.found ? 'look' : 'crop');
  }
  function closeEdit(apply) {
    const d = state.edit; if (!d) return;
    state.edit = null;
    URL.revokeObjectURL(d.url);
    if ($('lookImg').src) { URL.revokeObjectURL($('lookImg').src); $('lookImg').removeAttribute('src'); }
    if (apply) {
      const pg = d.pg, moved = JSON.stringify(d.quad) !== JSON.stringify(pg.quad);
      const changed = moved || d.turns !== pg.turns || d.mode !== pg.mode || d.strength !== pg.strength || d.straighten !== pg.straighten;
      Object.assign(pg, { quad: d.quad, turns: d.turns, mode: d.mode, strength: d.strength, straighten: d.straighten, skew: d.skew });
      if (moved) pg.found = true;
      if (changed) { if (state.result) clearResult(); refreshThumb(pg); }
    }
    show('scrHome');
  }
  $('btnEditDone').onclick = () => closeEdit(true);
  $('btnDelete').onclick = () => {
    const d = state.edit; if (!d) return;
    if (!confirm('Delete this page?')) return;
    closeEdit(false); removePage(d.pg);
  };
  function tab(which) {
    $('tabCrop').setAttribute('aria-selected', String(which === 'crop'));
    $('tabLook').setAttribute('aria-selected', String(which === 'look'));
    $('cropView').hidden = which !== 'crop'; $('lookView').hidden = which !== 'look';
    if (which === 'crop') requestAnimationFrame(placeHandles); else preview();
    syncLook();
  }
  $('tabCrop').onclick = () => tab('crop');
  $('tabLook').onclick = () => tab('look');

  // corners: shown over the photo; dragging one shows a magnifier so the corner can be placed exactly
  const handles = Array.from(document.querySelectorAll('.handle'));
  function geom() {
    const img = $('cropImg'), d = state.edit;
    const k = img.clientWidth / d.pg.w;
    return { k, ox: img.offsetLeft, oy: img.offsetTop };
  }
  function placeHandles() {
    const d = state.edit, img = $('cropImg'); if (!d || !img.complete || !img.clientWidth) return;
    const { k, ox, oy } = geom(), stage = $('cropStage');
    const pts = d.quad.map(([x, y]) => [ox + x * k, oy + y * k]);
    handles.forEach((h, i) => { h.style.left = pts[i][0] + 'px'; h.style.top = pts[i][1] + 'px'; });
    const svg = $('cropSvg');
    svg.setAttribute('viewBox', `0 0 ${stage.clientWidth} ${stage.clientHeight}`);
    $('cropPoly').setAttribute('points', pts.map(p => p.join(',')).join(' '));
  }
  $('cropImg').addEventListener('load', placeHandles);
  window.addEventListener('resize', () => { if (state.edit && !$('cropView').hidden) placeHandles(); });
  // Dragging: a finger anywhere near a corner (within about a fingertip and a half) moves the nearest corner, and the
  // corner keeps its distance from the finger, so the finger never hides it. The photo itself ignores touches, so a
  // long press can't open the browser's "open image / copy image" menu.
  let drag = null;
  const stage = $('cropStage');
  stage.addEventListener('pointerdown', e => {
    const d = state.edit; if (!d || e.button > 0) return;
    const r = $('cropImg').getBoundingClientRect(), k = r.width / d.pg.w;
    let best = -1, bestD = Infinity;
    d.quad.forEach(([x, y], i) => { const dd = Math.hypot(r.left + x * k - e.clientX, r.top + y * k - e.clientY); if (dd < bestD) { bestD = dd; best = i; } });
    if (best < 0 || bestD > 64) return;
    e.preventDefault();
    const [x, y] = d.quad[best];
    drag = { i: best, id: e.pointerId, dx: r.left + x * k - e.clientX, dy: r.top + y * k - e.clientY };
    stage.setPointerCapture(e.pointerId);
    handles[best].focus({ preventScroll: true });
    loupe(best);
  });
  stage.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = state.edit, r = $('cropImg').getBoundingClientRect(), k = r.width / d.pg.w;
    d.quad[drag.i] = [Math.max(0, Math.min(d.pg.w, (e.clientX + drag.dx - r.left) / k)), Math.max(0, Math.min(d.pg.h, (e.clientY + drag.dy - r.top) / k))];
    d.skew = 'auto';
    placeHandles(); loupe(drag.i);
  });
  const endDrag = e => { if (!drag || e.pointerId !== drag.id) return; drag = null; $('loupe').hidden = true; };
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
  for (const el of [stage, document.querySelector('.stage.look')]) el.addEventListener('contextmenu', e => e.preventDefault());
  handles.forEach((h, i) => {
    // keyboard: arrow keys move the corner
    h.addEventListener('keydown', e => {
      const step = e.shiftKey ? 20 : 4, d = state.edit, k = geom().k, m = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!m) return;
      e.preventDefault();
      d.quad[i] = [Math.max(0, Math.min(d.pg.w, d.quad[i][0] + m[0] * step / k)), Math.max(0, Math.min(d.pg.h, d.quad[i][1] + m[1] * step / k))];
      d.skew = 'auto'; placeHandles();
    });
  });
  function loupe(i) {
    const d = state.edit, c = $('loupe'), img = $('cropImg'), { k, ox, oy } = geom();
    const [x, y] = d.quad[i], g = c.getContext('2d'), src = Math.max(20, 40 / k);   // about 3x magnified
    g.fillStyle = '#fff'; g.fillRect(0, 0, 120, 120);
    g.drawImage(img, x - src / 2, y - src / 2, src, src, 0, 0, 120, 120);
    g.strokeStyle = '#a3541b'; g.lineWidth = 2; g.beginPath(); g.moveTo(60, 46); g.lineTo(60, 74); g.moveTo(46, 60); g.lineTo(74, 60); g.stroke();
    c.hidden = false;
    const px = ox + x * k, py = oy + y * k;
    c.style.left = Math.max(0, px - 60) + 'px';
    c.style.top = (py > 150 ? py - 150 : py + 30) + 'px';   // above the finger, or below it near the top
  }
  $('btnWhole').onclick = () => { const d = state.edit; d.quad = [[0, 0], [d.pg.w, 0], [d.pg.w, d.pg.h], [0, d.pg.h]]; d.skew = 'auto'; placeHandles(); };
  $('btnFind').onclick = async () => {
    const d = state.edit; $('btnFind').disabled = true;
    try {
      const r = await FlatbedWork.detect(d.pg.id, d.pg.blob);
      if (r.quad && state.edit === d) { d.quad = r.quad; d.skew = 'auto'; placeHandles(); }
      else toast('No page edge found. Place the corners by hand, or use the whole photo.');
    } catch (e) { toast(e && e.message || String(e)); }
    $('btnFind').disabled = false;
  };

  // the look: a preview at screen size, redone a moment after each change
  function syncLook() {
    const d = state.edit; if (!d) return;
    for (const b of document.querySelectorAll('#modeChips .chip-btn')) b.setAttribute('aria-checked', String(b.dataset.mode === d.mode));
    $('strengthRow').hidden = !MODES[d.mode];
    $('strengthLbl').textContent = MODES[d.mode] || '';
  }
  let previewTimer = 0;
  function preview(delay) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const d = state.edit; if (!d || $('lookView').hidden) return;
      const token = ++d.token;
      $('lookBusy').hidden = false;
      try {
        const max = Math.min(1800, Math.round(Math.max(600, $('scrEdit').clientWidth) * (window.devicePixelRatio || 1)));
        const skew = d.straighten ? (typeof d.skew === 'number' ? d.skew : 'auto') : 0;
        const r = await FlatbedWork.render(d.pg.id, d.pg.blob, { quad: d.quad, turns: d.turns, mode: d.mode, strength: d.strength, skew, maxSide: max, out: 'jpeg', quality: 0.85 });
        if (state.edit !== d || token !== d.token) return;
        if (d.straighten && skew === 'auto') d.skew = r.skew;
        const img = $('lookImg'), old = img.src;
        img.src = URL.createObjectURL(r.blob);
        if (old) URL.revokeObjectURL(old);
      } catch (e) { toast('Could not show the page: ' + (e && e.message || e)); }
      if (state.edit === d && token === d.token) $('lookBusy').hidden = true;
    }, delay || 0);
  }
  for (const b of document.querySelectorAll('#modeChips .chip-btn')) b.onclick = () => { const d = state.edit; d.mode = b.dataset.mode; syncLook(); preview(); };
  $('strength').addEventListener('input', () => { state.edit.strength = +$('strength').value; preview(220); });
  $('btnRotL').onclick = () => { state.edit.turns = (state.edit.turns + 3) % 4; preview(); };
  $('btnRotR').onclick = () => { state.edit.turns = (state.edit.turns + 1) % 4; preview(); };
  $('optStraighten').onchange = () => { const d = state.edit; d.straighten = $('optStraighten').checked; if (d.straighten) d.skew = 'auto'; preview(); };

  // ---------- making the PDF ----------
  const OPT_KEY = 'flatbed.options';   // remembered on this device: page size, text choice, languages (no content)
  const LANGS = FLATBED.languages.map(l => l[0]);
  const BY_LOCALE = { en: 'eng', fr: 'fra', es: 'spa', de: 'deu', th: 'tha' };
  const LETTER = ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'PR', 'CR', 'DO', 'SV', 'PA'];
  function defaults() {
    let region = '';
    try { region = new Intl.Locale(navigator.language || 'en').maximize().region || ''; } catch (e) {}
    const langs = [];
    for (const l of navigator.languages || [navigator.language || 'en']) { const c = BY_LOCALE[String(l).slice(0, 2).toLowerCase()]; if (c && !langs.includes(c)) langs.push(c); if (langs.length === 2) break; }
    return { size: LETTER.includes(region) ? 'letter' : 'a4', text: true, langs: langs.length ? langs : ['eng'] };
  }
  let opts = defaults();
  try { const o = JSON.parse(localStorage.getItem(OPT_KEY) || 'null'); if (o) opts = Object.assign(opts, o); } catch (e) { /* storage off: defaults */ }
  opts.langs = (opts.langs || []).filter(l => LANGS.includes(l)).slice(0, 2); if (!opts.langs.length) opts.langs = ['eng'];
  const saveOpts = () => { try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch (e) {} };
  const ocrOk = FlatbedOcr.supported();
  if (!ocrOk) opts.text = false;

  function syncOpts() {
    for (const b of document.querySelectorAll('#sizeChips .chip-btn')) b.setAttribute('aria-checked', String(b.dataset.size === opts.size));
    $('optSearchable').checked = opts.text; $('optImageOnly').checked = !opts.text;
    $('optSearchable').disabled = !ocrOk;
    for (const b of document.querySelectorAll('#langChips .chip-btn')) b.setAttribute('aria-pressed', String(opts.langs.includes(b.dataset.lang)));
    $('langOpt').hidden = !opts.text;
    $('ocrNote').hidden = ocrOk;
    $('ocrNote').textContent = ocrOk ? '' : 'This browser can\'t run the text recognition. Update it, or use a current Chrome, Firefox or Safari.';
    if (!ocrOk) $('langOpt').hidden = false;
  }
  for (const b of document.querySelectorAll('#sizeChips .chip-btn')) b.onclick = () => { opts.size = b.dataset.size; saveOpts(); syncOpts(); clearResult(); };
  $('optSearchable').onchange = $('optImageOnly').onchange = () => { opts.text = $('optSearchable').checked; saveOpts(); syncOpts(); clearResult(); };
  for (const b of document.querySelectorAll('#langChips .chip-btn')) b.onclick = () => {
    const l = b.dataset.lang;
    if (opts.langs.includes(l)) { if (opts.langs.length > 1) opts.langs = opts.langs.filter(x => x !== l); }
    else { opts.langs.push(l); if (opts.langs.length > 2) opts.langs.shift(); }
    saveOpts(); syncOpts(); clearResult();
  };
  $('fileName').addEventListener('input', clearResult);

  // what the PDF leaves out, in plain words
  function privacyList() {
    const photos = state.pages.filter(p => p.findings.length);
    const labels = [...new Set(photos.flatMap(p => p.findings.map(f => f.label)))];
    const cropped = state.pages.some(p => !isWhole(p));
    const li = (t, s) => `<li><b>${t}</b><small>${s}</small></li>`;
    $('removedList').innerHTML = [
      photos.length
        ? li('Hidden data in your photos', `${esc(labels.slice(0, 6).join(', '))}${labels.length > 6 ? ` and ${labels.length - 6} more` : ''}, in ${plural(photos.length, 'photo')}. None of it goes into the PDF.`)
        : li('Hidden data in your photos', 'None was found, and none is added. The pages are redrawn, so nothing from the photo files is copied.'),
      li('No author, app name or dates', 'The PDF has no title, author, app name, or creation and change dates.'),
      li('No document ID', 'Nothing that could link this PDF to other files, to this app or to your phone.'),
      cropped ? li('The surroundings', 'Only the page is kept: the table, your hands and the room around it are cut away.') : '',
      li('Your own file name', 'Camera names such as IMG_20261025_091233.jpg, which give away the date and time, aren\'t used.')
    ].join('');
  }
  const isWhole = p => { const q = p.quad; return q[0][0] < 2 && q[0][1] < 2 && q[2][0] > p.w - 2 && q[2][1] > p.h - 2; };

  $('btnExport').onclick = () => {
    if (!state.pages.length || state.pages.some(p => p.busy)) return;
    privacyList(); syncOpts();
    $('doneActions').hidden = !state.result; $('makeActions').hidden = !!state.result; $('optCard').hidden = !!state.result;
    show('scrExport');
  };
  function leaveExport() { show('scrHome'); }
  $('btnExportBack').onclick = () => { if (!state.making) leaveExport(); };

  function pdfName() {
    let n = ($('fileName').value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!n || n === '.pdf') n = 'scan.pdf';
    if (!/\.pdf$/i.test(n)) n += '.pdf';
    return n.slice(-120);
  }
  function clearResult() {
    if (!state.result) return;
    state.result = null;
    $('doneActions').hidden = true; $('makeActions').hidden = false; $('optCard').hidden = false;
  }

  $('btnMake').onclick = async () => {
    if (state.making || !state.pages.length) return;
    state.making = true;
    const btn = $('btnMake'), hint = $('makeHint'), n = state.pages.length, text = opts.text && ocrOk, langs = opts.langs.slice();
    btn.disabled = true; $('optCard').classList.add('disabled'); $('exportBackRow').hidden = true;
    for (const el of $('optCard').querySelectorAll('button, input')) el.disabled = true;
    const pages = [], texts = [];
    try {
      for (const [i, pg] of state.pages.entries()) {
        const base = look(pg, { maxSide: EXPORT });
        if (base.skew === 'auto') base.skew = 0;
        if (text) {
          $('btnMakeLbl').textContent = `Reading page ${i + 1} of ${n}…`;
          hint.textContent = i === 0 ? 'Text recognition runs on this device. The first page takes longest.' : '';
          const g = await FlatbedWork.render(pg.id, pg.blob, Object.assign({}, base, { out: 'pgm' }));
          const r = await FlatbedOcr.recognize(g.pgm, langs);
          pages[i] = { words: r.words };
          texts.push(r.text);
        } else pages[i] = {};
        $('btnMakeLbl').textContent = `Adding page ${i + 1} of ${n}…`;
        if (pg.mode === 'bw') {
          const r = await FlatbedWork.render(pg.id, pg.blob, Object.assign({}, base, { out: 'bits' }));
          Object.assign(pages[i], { w: r.w, h: r.h, image: { type: 'bits', stride: r.stride, bits: r.bits } });
        } else {
          const r = await FlatbedWork.render(pg.id, pg.blob, Object.assign({}, base, { out: 'jpeg', quality: 0.82 }));
          Object.assign(pages[i], { w: r.w, h: r.h, image: { type: 'jpeg', bytes: new Uint8Array(await r.blob.arrayBuffer()) } });
        }
      }
      $('btnMakeLbl').textContent = 'Putting the PDF together…'; hint.textContent = '';
      const font = Uint8Array.from(atob(FLATBED.font), c => c.charCodeAt(0));
      const raw = await P.build({ PDFLib: PDF, font, pages, size: opts.size, text });
      // the same cleaner as Unmarked, then a check of the result
      const clean = (await C.clean(raw, { pdfLib: PDF })).bytes;
      const check = await C.inspect(clean, { pdfLib: PDF });
      const left = check.error ? null : check.findings.filter(f => C.isRemoved(f, {}));
      state.result = { bytes: clean, name: pdfName(), text: texts.map((t, i) => n > 1 ? `--- Page ${i + 1} ---\n${t}` : t).join('\n\n').trim(), hasText: text };
      $('doneTitle').textContent = 'Your PDF is ready';
      $('doneSub').textContent = `${state.result.name} · ${plural(n, 'page')} · ${size(clean.length)}`;
      $('checkLine').textContent = !left ? '' : left.length ? `Please check: still found ${left.map(f => f.label).join(', ')}.` : '✓ Checked: no hidden data in the PDF.';
      $('checkLine').classList.toggle('warn', !!(left && left.length));
      $('btnShare').hidden = !canShare();
      $('saveHint').textContent = NATIVE || canPickFolder() ? 'Save lets you choose the folder and name.' : 'Save puts the PDF in your browser\'s Downloads folder. Most browsers can ask where to save instead: the manual (How to scan) explains how.';
      $('textActs').hidden = $('ocrDetails').hidden = !(text && state.result.text);
      $('ocrText').textContent = state.result.text;
      $('makeActions').hidden = true; $('optCard').hidden = true; $('doneActions').hidden = false;
      countUse();
    } catch (e) {
      toast('Could not make the PDF: ' + (e && e.message || e));
    } finally {
      FlatbedOcr.stop();   // frees the memory the text recognition used; it starts again when needed
      state.making = false;
      btn.disabled = false; $('btnMakeLbl').textContent = 'Make PDF'; hint.textContent = '';
      $('optCard').classList.remove('disabled'); $('exportBackRow').hidden = false;
      for (const el of $('optCard').querySelectorAll('button, input')) el.disabled = false;
      syncOpts();
    }
  };

  // ---------- saving and sharing ----------
  function download(name, bytes, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  // Saving: the Android app uses Android's own "save as" screen. Browsers that let a page open a "save as" dialog
  // (Chrome and Edge on a computer) use it, so the folder and name can be chosen; it starts in the folder used last
  // time. Other browsers (Chrome on Android, Firefox, Safari) save to their download folder.
  const canPickFolder = () => !NATIVE && typeof window.showSaveFilePicker === 'function';
  const TYPES = { 'application/pdf': { description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }, 'text/plain': { description: 'Text file', accept: { 'text/plain': ['.txt'] } } };
  async function saveAs(name, bytes, mime) {
    try {
      if (NATIVE) { const r = await FlatbedNative.saveFile(name, bytes, mime); if (!r.saved) return; toast('Saved.'); }
      else if (canPickFolder()) {
        let handle;
        try { handle = await window.showSaveFilePicker({ suggestedName: name, id: 'flatbed-save', startIn: 'documents', types: TYPES[mime] ? [TYPES[mime]] : undefined }); }
        catch (e) { if (e && e.name === 'AbortError') return; handle = null; }   // cancelled: nothing saved
        if (handle) {
          const w = await handle.createWritable();
          await w.write(new Blob([bytes], { type: mime })); await w.close();
          toast(`Saved as ${handle.name}.`);
        } else download(name, bytes, mime);   // the dialog couldn't open: save the usual way
      }
      else download(name, bytes, mime);   // browsers save to their usual download folder
      if (state.result) state.result.saved = true;
    } catch (e) { if (!e || e.name !== 'AbortError') toast('Could not save: ' + (e && e.message || e)); }
  }
  const webShareOk = () => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.pdf', { type: 'application/pdf' })] })); } catch (e) { return false; } };
  const canShare = () => NATIVE || webShareOk();
  $('btnSave').onclick = () => { const r = state.result; if (r) saveAs(r.name, r.bytes, 'application/pdf'); };
  $('btnShare').onclick = async () => {
    const r = state.result; if (!r) return;
    try {
      if (NATIVE) await FlatbedNative.share([{ name: r.name, bytes: r.bytes, mime: 'application/pdf' }]);
      else await navigator.share({ files: [new File([r.bytes], r.name, { type: 'application/pdf' })] });
      r.saved = true;
    } catch (e) { if (!e || e.name !== 'AbortError') toast('Could not share: ' + (e && e.message || e)); }
  };
  $('btnCopyText').onclick = async () => {
    const r = state.result; if (!r) return;
    try { await navigator.clipboard.writeText(r.text); toast('Text copied.'); }
    catch (e) { toast('Could not copy. Select the text below and copy it instead.'); $('ocrDetails').open = true; }
  };
  $('btnSaveText').onclick = () => { const r = state.result; if (r) saveAs(r.name.replace(/\.pdf$/i, '') + '.txt', new TextEncoder().encode(r.text + '\n'), 'text/plain'); };
  // make another version (another size, image-only, other languages) from the same pages
  $('btnChangeOpts').onclick = () => {
    if (state.result && !state.result.saved && !confirm('Change the options? This PDF hasn\'t been saved or shared yet; you can make it again.')) return;
    clearResult(); syncOpts(); window.scrollTo(0, 0);
  };
  $('btnNewScan').onclick = () => {
    if (state.result && !state.result.saved && !confirm('Start a new scan? This PDF hasn\'t been saved or shared yet.')) return;
    for (const pg of state.pages.slice()) removePage(pg);
    clearResult(); $('fileName').value = 'scan.pdf';
    show('scrHome');
  };

  // Pages exist only in memory: leaving the page (a link opens in the same tab) would lose them, so ask first
  window.addEventListener('beforeunload', e => { if (!NATIVE && state.pages.length) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- gentle donation request (same as the studio's other apps) ----------
  // Each PDF made counts as one use. At 20, 50 and 100 uses a card appears under the save buttons;
  // "Not now" hides it until the next milestone, and after Ko-fi is tapped it never appears again.
  const SUP_KEY = 'flatbed.support', DONATE_AT = [20, 50, 100];
  const getSup = () => { try { return JSON.parse(localStorage.getItem(SUP_KEY) || '{}') || {}; } catch (e) { return {}; } };
  const putSup = p => { try { localStorage.setItem(SUP_KEY, JSON.stringify(Object.assign(getSup(), p))); } catch (e) {} };
  function countUse() {
    const c = $('donateCard'); if (!c) return;
    const s = getSup(), n = (+s.uses || 0) + 1, m = DONATE_AT.filter(x => n >= x).pop() || 0;
    putSup({ uses: n });
    c.hidden = !!s.donateDone || !m || (+s.donateSeen || 0) >= m;
    if (!c.hidden) { $('donateN').textContent = n; c.dataset.m = m; }
  }
  if ($('donateCard')) {
    $('btnDonate').addEventListener('click', () => { putSup({ donateDone: true }); $('donateCard').hidden = true; });
    $('btnDonateLater').onclick = () => { putSup({ donateSeen: +$('donateCard').dataset.m }); $('donateCard').hidden = true; };
  }

  // ---------- photos shared to the Android app ----------
  if (NATIVE) {
    let taking = false;
    const take = async () => {
      if (taking) return; taking = true;
      try { const got = await FlatbedNative.takeShared(); if (got.length && !state.making) { show('scrHome'); addPhotos(got, 'import'); } }
      catch (e) { toast('Could not open the shared photos: ' + (e && e.message || e)); }
      finally { taking = false; }
    };
    FlatbedNative.onShared(take);
    take();
  }

  show('scrHome');
  renderPages();
})();
