# Flatbed

**Scan documents into clean, searchable PDFs, on your own device.**
Photograph a letter, form, receipt or ID: Flatbed finds the page, flattens and straightens it, cleans it up, reads the
text and makes a PDF with no hidden details about you or your phone. No account, no server, no upload.

**Use it now: [flatbed.anonacondacodelab.com](https://flatbed.anonacondacodelab.com)**

## Why it exists
A scanner sees your most private papers: passport copies for a visa or a rental, bank letters, tax forms, payslips,
contracts, prescriptions and test results. Most scanner apps upload them to read the text. Flatbed can't: the web app
blocks every network connection and the Android app has no internet permission. And the PDF it makes carries only the
pages: no location, phone model or date from the photos, no author, app name, dates or document IDs in the file.

## Features
- **Camera or import:** a live camera view that outlines the page (web app), or the phone's own camera app (Android, so
  Flatbed needs no camera permission); import photos from the gallery, or share them to the app.
- **Page detection and perspective correction:** the page's corners are found automatically and can be dragged by
  hand, with a magnifier; the page is flattened as if it had been on a scanner's glass.
- **Straightening:** slightly tilted lines of text are levelled.
- **Clean-up:** Original, Enhanced (white paper, shadows and uneven light removed), Grey, and Black & white (stored at 1 bit
  a pixel: sharp and small), with a contrast slider; turn by 90°.
- **Several pages,** reordered with arrows.
- **Text recognition, fully offline:** [Tesseract](https://github.com/tesseract-ocr/tesseract) compiled to WebAssembly,
  with English, French, Spanish, German and Thai built in. The text is added to the PDF as an invisible layer, so the
  PDF can be searched and its text copied; copy or save the text on its own, too.
- **Image-only option:** a PDF with no text layer at all.
- **Private by default:** a panel lists what is left out before you make the PDF, and every PDF goes through Unmarked's
  cleaner and is checked before it is offered.
- Page size A4, Letter or the shape of the scan; your own file name.

## How it works
The whole web app is one file, `dist/index.html`, built by `node build.mjs` from `src/`. Its Content Security Policy
blocks every connection (`connect-src 'none'`); it allows workers only from `blob:` addresses that the page makes from
its own code, and WebAssembly (`'wasm-unsafe-eval'`) for the text recognition. The engine and the language files are
embedded in the page (gzipped, about 6.5 MB of the 9 MB) and unpacked when text is first read.

- `src/scan.js`: page detection (edges, convex hull, largest four-cornered shape that the edges follow), perspective
  correction, straightening (projection profile) and clean-up (paper-brightness map). Plain JavaScript, no dependencies;
  runs in a worker (`src/work.js`) and in Node for the tests.
- `src/ocr-engine.js`: drives [tesseract.js-core](https://github.com/naptha/tesseract.js-core) directly in a worker,
  handing it the engine and language data (so it never downloads anything).
- `src/pdf.js`: the PDF, with [pdf-lib](https://github.com/Hopding/pdf-lib); the invisible text uses Tesseract's
  half-kilobyte "glyphless" font, which works for any script.
- `src/clean.js`: copied unchanged from [Unmarked](https://github.com/Anonaconda-CodeLab/unmarked) (commit
  `2e038a5`); `tests/build.test.mjs` notes if the two drift apart.

`dist/` is not committed: [Cloudflare Pages](https://pages.cloudflare.com) runs `node build.mjs` and publishes `dist/`, including the
HTTP headers in `dist/_headers` (no framing by other sites, no connections, no referrer). Settings: build command
`node build.mjs`, output directory `dist`, environment variable `NODE_VERSION=22`. Web Analytics stays off.

## Development
```
node build.mjs          # builds dist/
npm test                # builds, then runs the tests (Node's built-in runner, no dependencies)
```
The tests run page detection on synthetic photos, text recognition in English and Thai with the bundled engine, and
check the PDFs (text layer, image-only, page sizes, no hidden data; `pdftotext` from poppler-utils is used when
present). Test images are made by `tests/fixtures/make-fixtures.py` (Pillow). The Android app is in `mobile/` (see
`mobile/README.md`).

## Disclaimer
Flatbed is provided **as is, without any warranty**. Text recognition makes mistakes; check important text. Flatbed
leaves hidden data out of its PDFs, but what's visible on the page is in the scan. You are responsible for what you
share; Anonaconda Code Lab accepts no liability for any loss or harm from using this software.

## Licence
Free software under the [GNU General Public License v3 or later](LICENSE), with no warranty. © 2026 Anonaconda Code Lab.
Third-party components: see [NOTICE.md](NOTICE.md). Security and privacy: see [SECURITY.md](SECURITY.md).
Questions or problems: hello@anonacondacodelab.com.
