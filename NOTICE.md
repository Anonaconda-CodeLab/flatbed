# Notices

## Third-party components
The built app embeds:

| Component | Version | Licence |
|---|---|---|
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) (`src/vendor/tesseract-core-simd-lstm.js` and `.wasm.gz`, unmodified, wasm gzipped): the [Tesseract](https://github.com/tesseract-ocr/tesseract) OCR engine and Leptonica compiled to WebAssembly | 6.1.2 | Apache-2.0 ([src/vendor/LICENSE-tesseract.txt](src/vendor/LICENSE-tesseract.txt)); Leptonica: BSD-2-Clause |
| Tesseract language data, "fast" models (`src/lang/`: eng, fra, spa, deu, tha; gzipped, unmodified) from [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) commit `8741641` | | Apache-2.0 |
| Tesseract's glyphless font (`src/vendor/glyphless.ttf`, unmodified, from `tessdata/pdf.ttf`) | | Apache-2.0 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) (`src/vendor/pdf-lib.min.js`, unmodified) | 1.17.1 | MIT ([src/vendor/LICENSE-pdf-lib.md](src/vendor/LICENSE-pdf-lib.md)) |
| `src/clean.js` from [Unmarked](https://github.com/Anonaconda-CodeLab/unmarked) (Anonaconda Code Lab) | commit `2e038a5` | GPL-3.0-or-later |
| Instrument Sans typeface | | SIL Open Font License 1.1 ([src/fonts/OFL-InstrumentSans.txt](src/fonts/OFL-InstrumentSans.txt)) |
| IBM Plex Mono typeface | | SIL Open Font License 1.1 ([src/fonts/OFL-IBMPlexMono.txt](src/fonts/OFL-IBMPlexMono.txt)) |

pdf-lib itself bundles pako (MIT) and parts of the TypeScript runtime library (0BSD/Apache-2.0); their notices are kept in
the file. Apache-2.0 components are compatible with the GPL v3 that covers Flatbed as a whole.

The **Android app** (built from `mobile/`) also includes:

| Component | Version | Licence |
|---|---|---|
| [Capacitor](https://capacitorjs.com) (`@capacitor/android`, `@capacitor/core`) | 8.5.3 | MIT |
| AndroidX libraries (AppCompat, Core, CoordinatorLayout, Core SplashScreen, Activity, WebKit) | see `mobile/android/variables.gradle` | Apache-2.0 |

Test images in `tests/fixtures/` were made with Pillow (`make-fixtures.py`) and the DejaVu and TLWG Loma fonts; the
tools and fonts themselves are not part of the app.
