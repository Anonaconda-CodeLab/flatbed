/* Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
   ---------- Android app (Capacitor) ----------
   In the Android app the page runs inside Android's WebView, which can't use the camera without a permission, save
   files or share them. This file supplies native stand-ins: taking a photo with the phone's own camera app (so the
   app needs no camera permission), Android's file picker, saving (Android's "save as" screen), sharing (the share
   sheet), and receiving photos shared to Flatbed from the gallery. In a browser NATIVE is false and nothing here is used.
   Everything stays on the phone: the app has no internet permission. */
const NATIVE = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
const nativeCall = (plugin, method, opts) => window.Capacitor.nativePromise(plugin, method, opts || {});
const nativeOn = (plugin, event, cb) => window.Capacitor.addListener(plugin, event, cb);
const CHUNK = 384 * 1024;   // bytes per bridge call (sent as base64)
const NATIVE_MAX = 60 * 1024 * 1024;   // same limit as the page (MAX_BYTES in app.js): larger files are never read
const toB64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = s => { const b = atob(s || ''), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const FlatbedNative = NATIVE ? {
  // pick the place first (name only: Android limits what a pending call may carry), then write in pieces
  async saveFile(name, bytes, mime) {
    const r = await nativeCall('Flatbed', 'pickSaveLocation', { name, mime: mime || 'application/octet-stream' });
    if (!r || !r.uri) return { saved: false };
    for (let i = 0; i === 0 || i < bytes.length; i += CHUNK)
      await nativeCall('Flatbed', 'writeChunk', { uri: r.uri, data: toB64(bytes.subarray(i, i + CHUNK)), first: i === 0, last: i + CHUNK >= bytes.length });
    return { saved: true };
  },
  // copy the files into the app's private share folder, then open Android's share sheet
  async share(files) {
    await nativeCall('Flatbed', 'shareBegin');
    for (const [k, f] of files.entries())
      for (let i = 0; i === 0 || i < f.bytes.length; i += CHUNK)
        await nativeCall('Flatbed', 'shareChunk', { index: k, name: f.name, data: toB64(f.bytes.subarray(i, i + CHUNK)), first: i === 0, last: i + CHUNK >= f.bytes.length });
    await nativeCall('Flatbed', 'shareSend', { count: files.length, mimes: files.map(f => f.mime || 'application/octet-stream') });
  },
  // read files the native side holds (photos taken, picked or shared) in pieces.
  // A file over the limit is not read (it could run the app out of memory): it is passed on with its size only, and the
  // page shows "too large". The size Android reports is checked first; reading also stops at the limit, in case it was wrong.
  async readHeld(list) {
    const out = [];
    for (const it of list || []) {
      const name = it.name || 'photo', mime = it.mime || '';
      if (+it.size > NATIVE_MAX) { out.push({ name, bytes: null, size: +it.size, mime }); continue; }
      const parts = []; let offset = 0;
      for (;;) {
        const c = await nativeCall('Flatbed', 'readShared', { id: it.id, offset, length: CHUNK });
        const u = fromB64(c && c.data); parts.push(u); offset += u.length;
        if (!c || c.eof || !u.length || offset > NATIVE_MAX) break;
      }
      if (offset > NATIVE_MAX) { out.push({ name, bytes: null, size: offset, mime }); continue; }
      const bytes = new Uint8Array(offset); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
      out.push({ name, bytes, mime });
    }
    await nativeCall('Flatbed', 'clearShared').catch(() => {});
    return out;
  },
  // the phone's own camera app takes the photo and hands it back (no camera permission for Flatbed itself)
  async takePhoto() { const r = await nativeCall('Flatbed', 'takePhoto'); return this.readHeld(r && r.files); },
  // photos shared to Flatbed from another app ("Share → Flatbed")
  async takeShared() { const r = await nativeCall('Flatbed', 'getShared'); return this.readHeld(r && r.files); },
  // Android's own file picker
  async pickFiles() { const r = await nativeCall('Flatbed', 'pickFiles'); return this.readHeld(r && r.files); },
  onShared: cb => nativeOn('Flatbed', 'shared', cb),
  openUrl: url => nativeCall('Flatbed', 'openUrl', { url })
} : null;

if (NATIVE) (() => {
  document.documentElement.classList.add('native');   // shows Android-only buttons (Check for updates)
  // links to websites and email open in the phone's browser or mail app, never inside the app
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest && e.target.closest('a[href]'); if (!a) return;
    const href = a.getAttribute('href') || '';
    if (/^(https:|mailto:)/i.test(href)) { e.preventDefault(); FlatbedNative.openUrl(href).catch(() => {}); }
  }, true);
})();
