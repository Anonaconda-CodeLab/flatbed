/* Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
   ---------- Flatbed PDF maker ----------
   Puts the scanned pages into a PDF with pdf-lib, optionally with the recognised text as an invisible layer, so the
   PDF can be searched and its text selected and copied. The text uses a "glyphless" font (from Tesseract): it draws
   nothing and weighs about half a kilobyte, yet works for any script, Thai included.

   No metadata is written: no title, author, app name, dates or document IDs. The caller runs the result through the
   Unmarked cleaner as well, and checks it, so this stays true even if a library changes its defaults.

   API (global FlatbedPdf):
     build({ PDFLib, font, pages, size, text })  -> Promise<Uint8Array>
       font  = the glyphless font file's bytes
       size  = 'a4' | 'letter' | 'fit' (page shaped like the scan)
       text  = true to add the text layer
       pages = [{ w, h, image, words? }]  w, h = the scan's size in pixels
         image = { type: 'jpeg', bytes } | { type: 'bits', stride, bits }   (bits: 1 bit a pixel, 1 = white)
         words = [{ text, x, y, w, h, line }] in the same pixels (from the text recognition) */
(function (root) {
  'use strict';

  const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
  const CHAR_W = 0.5;   // the glyphless font's advance width, in text space units (1000/2 per 1000)

  // the font objects, as in Tesseract's own PDF output
  function addFont(L, doc, fontBytes) {
    const ctx = doc.context;
    const map = new Uint8Array(2 * 65536); for (let i = 1; i < map.length; i += 2) map[i] = 1;   // every character -> glyph 1
    const cidToGid = ctx.register(ctx.flateStream(map));
    const cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo\n<<\n  /Registry (Adobe)\n  /Ordering (UCS)\n  /Supplement 0\n>> def\n' +
      '/CMapName /Adobe-Identify-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n1 beginbfrange\n<0000> <FFFF> <0000>\nendbfrange\n' +
      'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
    const toUnicode = ctx.register(ctx.flateStream(cmap));
    const file = ctx.register(ctx.flateStream(fontBytes, { Length1: fontBytes.length }));
    const desc = ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: 'GlyphLessFont', Flags: 5, FontBBox: [0, 0, 500, 1000], ItalicAngle: 0,
      Ascent: 1000, Descent: -1, CapHeight: 1000, StemV: 80, FontFile2: file }));
    const cid = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'GlyphLessFont',
      CIDSystemInfo: { Registry: L.PDFString.of('Adobe'), Ordering: L.PDFString.of('Identity'), Supplement: 0 }, FontDescriptor: desc, DW: 500, CIDToGIDMap: cidToGid }));
    return ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'GlyphLessFont', Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: toUnicode }));
  }

  const n = v => (Math.round(v * 100) / 100).toString();
  function utf16hex(s) {
    let h = '';
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c > 0xffff || c < 0x20) continue;   // the font's map covers the basic plane; control characters are dropped
      h += c.toString(16).padStart(4, '0');
    }
    return h;
  }

  // invisible text for one page: each word placed over its box and stretched to its width; all words of a line share
  // the line's height and bottom edge, so text tools see them as one line
  function textOps(words, fontName, sx, sy, ox, oy, imgH) {
    const lines = new Map();
    for (const w of words) {
      const l = lines.get(w.line) || { top: Infinity, bottom: -Infinity };
      l.top = Math.min(l.top, w.y); l.bottom = Math.max(l.bottom, w.y + w.h); lines.set(w.line, l);
    }
    const out = ['BT', '3 Tr'];
    for (let i = 0; i < words.length; i++) {
      const wd = words[i], next = words[i + 1], same = next && next.line === wd.line, ln = lines.get(wd.line);
      const hex = utf16hex(wd.text + (same ? ' ' : ''));   // a space after each word except the last of its line
      if (!hex) continue;
      const chars = hex.length / 4, size = Math.max(1, (ln.bottom - ln.top) * sy);
      const width = (wd.w + (same ? Math.max(0, next.x - wd.x - wd.w) : 0)) * sx;
      const stretch = 100 * width / (chars * size * CHAR_W);
      const x = ox + wd.x * sx, y = oy + (imgH - ln.bottom) * sy;
      out.push(`/${fontName} ${n(size)} Tf`, `${n(stretch)} Tz`, `1 0 0 1 ${n(x)} ${n(y)} Tm`, `<${hex}> Tj`);
    }
    out.push('ET');
    return out.join('\n');
  }

  async function build({ PDFLib: L, font, pages, size = 'a4', text = true }) {
    const doc = await L.PDFDocument.create({ updateMetadata: false });
    const ctx = doc.context;
    const fontRef = text && pages.some(p => p.words && p.words.length) ? addFont(L, doc, font) : null;
    for (const p of pages) {
      // page size and where the scan sits on it
      let pw, ph;
      const land = p.w > p.h;
      if (SIZES[size]) { [pw, ph] = SIZES[size]; if (land) [pw, ph] = [ph, pw]; }
      else { const s = 841.89 / Math.max(p.w, p.h); pw = p.w * s; ph = p.h * s; }
      const scale = Math.min(pw / p.w, ph / p.h), iw = p.w * scale, ih = p.h * scale, ox = (pw - iw) / 2, oy = (ph - ih) / 2;
      const page = doc.addPage([pw, ph]);
      if (p.image.type === 'jpeg') {
        const img = await doc.embedJpg(p.image.bytes);
        page.drawImage(img, { x: ox, y: oy, width: iw, height: ih });
      } else {
        // black and white: 1 bit a pixel, compressed; far smaller than JPEG and perfectly sharp
        const st = ctx.flateStream(p.image.bits, { Type: 'XObject', Subtype: 'Image', Width: p.w, Height: p.h, ColorSpace: 'DeviceGray', BitsPerComponent: 1 });
        const name = page.node.newXObject('Im', ctx.register(st));
        page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(iw, 0, 0, ih, ox, oy), L.drawObject(name), L.popGraphicsState());
      }
      if (fontRef && p.words && p.words.length) {
        const fname = page.node.newFontDictionary('F', fontRef);
        const ops = textOps(p.words, fname.asString().slice(1), scale, scale, ox, oy, p.h);
        page.node.addContentStream(ctx.register(ctx.flateStream(ops)));
      }
    }
    return doc.save({ useObjectStreams: true, addDefaultPage: false });
  }

  const api = { build, utf16hex, SIZES };
  root.FlatbedPdf = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
