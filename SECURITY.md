# Security and privacy

## Design
- **No network access.** The built page carries a Content Security Policy with `default-src 'none'; connect-src 'none'`,
  so the app cannot send or fetch anything, even if malicious code were injected. Fonts, pdf-lib, the text-recognition
  engine and its language files are embedded; there are no external scripts, analytics or trackers. Two additions over
  Unmarked's policy, both needed for text recognition and neither able to reach the network: `worker-src blob:` (the
  two workers are started from code already in the page) and `'wasm-unsafe-eval'` (to start the WebAssembly engine; no
  JavaScript `eval`). The only outbound links are the optional *Source code* and *Support on Ko-fi* buttons and links in
  the manual, which open in the same tab (the page asks first if scans would be lost).
- **Nothing stored.** Photos and pages are held in memory while the page is open and are gone when it closes. The only
  things kept on the device are the PDF options (page size, text, languages) and a count of PDFs made, used only for an
  occasional donation request (browser localStorage).
- **Nothing copied from the photos.** Every page is decoded and redrawn; no part of the photo file (EXIF, XMP, GPS,
  maker notes, thumbnails) reaches the PDF. The PDF is written without metadata, put through Unmarked's cleaner, and
  inspected again before it is offered; anything still found is shown as a warning.
- **Originals untouched.** Flatbed only reads the photos you give it.
- **Untrusted input.** Photos are decoded by the browser; files are inspected by Unmarked's bounds-checked parsers, and
  all text from files is escaped before display. Recognised text is shown as plain text only.
- **Translation.** Document content (pages, recognised text, file name) is marked `translate="no"`, so a browser's
  translate feature, which sends page text to an online service, leaves it out.

## Android app
- **No internet permission.** It is removed in the manifest, and every build fails if it reappears.
- **No camera permission, and no other permissions.** Photos are taken by the phone's own camera app, which writes one
  photo into a private folder inside Flatbed through a temporary grant; Flatbed deletes it once the page has read it.
  Imported photos come from Android's picker or another app's Share action, which grant access to those photos only.
  PDFs are saved through Android's "save as" screen or shared through the share sheet (from a private folder inside the
  app, emptied before each share).
- **Signed releases.** Official APKs are signed with the studio's key. Its SHA-256 certificate fingerprint is published on
  the Android page and in every release, and the release build fails if an APK is signed with any other key. Each
  release also lists the APK's SHA-256 checksum.

## Known limitations
- What is visible on the page is in the scan. Flatbed leaves out hidden data, not visible content.
- HEIC photos can only be imported where the browser can open them (not in Chrome on Android); convert them to JPEG.
- Text recognition needs WebAssembly SIMD (Chrome 91+, Firefox 89+, Safari 16.4+); older browsers can make image-only PDFs.

## Reporting a vulnerability
Please report security issues privately using GitHub's **Security → Report a vulnerability** (private vulnerability
reporting) on this repository rather than opening a public issue, or email hello@anonacondacodelab.com. Include steps
to reproduce and the affected version. Please don't attach private documents; a test image that shows the problem is
best.
