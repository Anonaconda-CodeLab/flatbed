/* Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
   ---------- Flatbed PDF password ----------
   Protects a finished PDF with a password needed to open it: the PDF standard security handler with AES-256 (V 5, R 6,
   ISO 32000-2), which every current reader opens (Chrome, Firefox, Android's viewer, Acrobat, macOS Preview).
   Only WebCrypto is used (AES-CBC, SHA-256/384/512, random numbers); nothing leaves the device.

   It runs last, on the PDF that has already been cleaned and checked (the cleaner and the check can't read an encrypted
   file). Every stream's bytes and every string are encrypted with the file key; nothing else is added (no /Info, no
   metadata). All permissions are granted (printing, copying): readers may ignore those flags, so they would only give a
   false sense of protection. The owner password is random and kept nowhere.

   The password is used as the UTF-8 bytes of what was typed (at most 127 bytes), without SASLprep: Chrome, Android's
   viewer, Firefox and qpdf use the typed bytes, so a password with characters that SASLprep changes (Thai sara am,
   full-width letters) still opens there. Adobe Acrobat applies SASLprep, so such a password may not open in Acrobat.

   API (global FlatbedEncrypt):
     encrypt(bytes, password, { PDFLib })  -> Promise<Uint8Array>   the protected PDF
     hash2B(password, salt, udata)         -> Promise<Uint8Array>   ISO 32000-2 Algorithm 2.B (for tests)
     passwordBytes(password)               -> Uint8Array            UTF-8, first 127 bytes */
(function (root) {
  'use strict';

  const subtle = () => root.crypto.subtle;
  const random = n => root.crypto.getRandomValues(new Uint8Array(n));
  const cat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const passwordBytes = pw => new TextEncoder().encode(String(pw)).slice(0, 127);

  // AES-CBC without padding (the input is a whole number of blocks): WebCrypto always pads, so the extra block is dropped
  async function aesNoPad(key, iv, data) {
    const k = await subtle().importKey('raw', key, 'AES-CBC', false, ['encrypt']);
    return new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, k, data)).subarray(0, data.length);
  }
  // AES-256-CBC with PKCS#7 padding and a random IV in front: how R6 encrypts each string and stream
  async function aesObject(key, data) {
    const iv = random(16);
    return cat(iv, new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, key, data)));
  }

  // ISO 32000-2, Algorithm 2.B: the password hash for revision 6
  async function hash2B(pw, salt, udata = new Uint8Array(0)) {
    let K = new Uint8Array(await subtle().digest('SHA-256', cat(pw, salt, udata)));
    let E = null;
    for (let i = 0; i < 64 || E[E.length - 1] > i - 32; i++) {
      const one = cat(pw, K, udata), K1 = new Uint8Array(one.length * 64);
      for (let j = 0; j < 64; j++) K1.set(one, j * one.length);
      E = await aesNoPad(K.subarray(0, 16), K.subarray(16, 32), K1);
      let m = 0; for (let j = 0; j < 16; j++) m += E[j];   // the first 16 bytes as a number, modulo 3 (256 ≡ 1)
      K = new Uint8Array(await subtle().digest(['SHA-256', 'SHA-384', 'SHA-512'][m % 3], E));
    }
    return K.slice(0, 32);
  }

  const P_ALL = -4;   // every permission granted (bits 1 and 2 must be 0, the rest 1)

  // the /Encrypt values for a new random file key (ISO 32000-2, Algorithms 8, 9 and 10)
  async function securityValues(userPw) {
    const fileKey = random(32), zero = new Uint8Array(16);
    const uVal = random(8), uKey = random(8), U = cat(await hash2B(userPw, uVal), uVal, uKey);
    const UE = await aesNoPad(await hash2B(userPw, uKey), zero, fileKey);
    const ownerPw = random(32), oVal = random(8), oKey = random(8);
    const O = cat(await hash2B(ownerPw, oVal, U), oVal, oKey);
    const OE = await aesNoPad(await hash2B(ownerPw, oKey, U), zero, fileKey);
    const perms = new Uint8Array(16);
    new DataView(perms.buffer).setInt32(0, P_ALL, true);
    perms.set([0xFF, 0xFF, 0xFF, 0xFF, 0x54 /* T: metadata encrypted too */, 0x61, 0x64, 0x62 /* adb */], 4);
    perms.set(random(4), 12);
    const Perms = await aesNoPad(fileKey, zero, perms);   // one block with a zero IV: AES-256-ECB
    return { fileKey, U, UE, O, OE, Perms };
  }

  const hex = b => Array.from(b, v => v.toString(16).padStart(2, '0')).join('');

  async function encrypt(bytes, password, { PDFLib: L }) {
    const pw = passwordBytes(password);
    if (!pw.length) throw new Error('No password');
    const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
    const ctx = doc.context;
    const v = await securityValues(pw);
    const key = await subtle().importKey('raw', v.fileKey, 'AES-CBC', false, ['encrypt']);
    const Name = n => L.PDFName.of(n);

    // every string, wherever it sits in an object (dictionaries and arrays nest)
    async function strings(obj) {
      const enc = async s => L.PDFHexString.of(hex(await aesObject(key, s.asBytes())));
      const isStr = x => x instanceof L.PDFString || x instanceof L.PDFHexString;
      if (obj instanceof L.PDFDict) {
        for (const [k, x] of obj.entries()) {
          if (isStr(x)) obj.set(k, await enc(x)); else await strings(x);
        }
      } else if (obj instanceof L.PDFArray) {
        for (let i = 0; i < obj.size(); i++) {
          const x = obj.get(i);
          if (isStr(x)) obj.set(i, await enc(x)); else await strings(x);
        }
      }
    }
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (obj instanceof L.PDFStream) {
        const type = obj.dict.get(Name('Type'));
        if (type === Name('XRef') || type === Name('ObjStm')) { ctx.delete(ref); continue; }   // rewritten on save
        await strings(obj.dict);
        const data = await aesObject(key, obj instanceof L.PDFRawStream ? obj.contents : obj.getContents());
        obj.dict.set(Name('Length'), L.PDFNumber.of(data.length));
        ctx.assign(ref, L.PDFRawStream.of(obj.dict, data));
      } else if (obj instanceof L.PDFString || obj instanceof L.PDFHexString) {
        ctx.assign(ref, L.PDFHexString.of(hex(await aesObject(key, obj.asBytes()))));
      } else await strings(obj);
    }

    // the security handler's dictionary: added after the loop, so its own strings are never encrypted
    const H = b => L.PDFHexString.of(hex(b));
    const encDict = ctx.obj({
      Filter: 'Standard', V: 5, R: 6, Length: 256, P: P_ALL, EncryptMetadata: true,
      CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } }, StmF: 'StdCF', StrF: 'StdCF'
    });
    for (const [k, b] of [['O', v.O], ['U', v.U], ['OE', v.OE], ['UE', v.UE], ['Perms', v.Perms]]) encDict.set(Name(k), H(b));
    ctx.trailerInfo.Encrypt = ctx.register(encDict);
    const id = random(16);
    ctx.trailerInfo.ID = ctx.obj([H(id), H(id)]);
    // AES-256 is an extension to PDF 1.7 (ISO 32000-2's revision 6), declared the way Acrobat and qpdf do
    doc.catalog.set(Name('Extensions'), ctx.obj({ ADBE: { BaseVersion: Name('1.7'), ExtensionLevel: 8 } }));
    // no object streams: each object is encrypted on its own, and the cross-reference table must stay readable
    return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  }

  const api = { encrypt, hash2B, passwordBytes };
  root.FlatbedEncrypt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
