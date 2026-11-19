/* Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
   ---------- Flatbed: LINE's built-in browser ----------
   Links sent in a LINE chat open in LINE's own browser, which can't save or share files. There, and only there
   (never in the Android app), a banner offers to open the same address in the phone's own browser, using LINE's
   documented parameter openExternalBrowser=1 (developers.line.biz, "Using LINE features with the LINE URL scheme"). */
const FlatbedLine = (() => {
  'use strict';
  const inLine = ua => /\bLine\//.test(String(ua || ''));
  const externalUrl = href => { const u = new URL(href); u.searchParams.set('openExternalBrowser', '1'); return u.href; };
  function init() {
    const native = !!(globalThis.Capacitor && typeof globalThis.Capacitor.isNativePlatform === 'function' && globalThis.Capacitor.isNativePlatform());
    const bar = document.getElementById('lineBar');
    if (!bar || native || !inLine(navigator.userAgent)) return;
    document.getElementById('lineOpen').href = externalUrl(location.href);
    bar.hidden = false;
  }
  if (typeof document !== 'undefined') init();
  return { inLine, externalUrl };
})();
globalThis.FlatbedLine = FlatbedLine;
