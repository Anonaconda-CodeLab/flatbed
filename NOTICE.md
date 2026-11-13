# Notices

## Third-party components
The built app embeds the components below. Their licence texts ship with the app: the **Licences** screen (About →
Licences) and `licences.txt` next to the page (also inside the APK), both made by `build.mjs` from the files linked here.

| Component | Version | Licence |
|---|---|---|
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) (`src/vendor/tesseract-core-simd-lstm.js` and `.wasm.gz`, unmodified, wasm gzipped): the [Tesseract](https://github.com/tesseract-ocr/tesseract) OCR engine and [Leptonica](http://www.leptonica.org) compiled to WebAssembly | 6.1.2 | Apache-2.0 ([src/vendor/LICENSE-tesseract.txt](src/vendor/LICENSE-tesseract.txt)); Leptonica: BSD-2-Clause ([src/vendor/LICENSE-leptonica.txt](src/vendor/LICENSE-leptonica.txt)) |
| Tesseract language data, "fast" models (`src/lang/`: eng, fra, spa, deu, tha; gzipped, unmodified) from [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) commit `8741641` | | Apache-2.0 |
| Tesseract's glyphless font (`src/vendor/glyphless.ttf`, unmodified, from `tessdata/pdf.ttf`) | | Apache-2.0 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) (`src/vendor/pdf-lib.min.js`, unmodified) | 1.17.1 | MIT ([src/vendor/LICENSE-pdf-lib.md](src/vendor/LICENSE-pdf-lib.md)) |
| `src/clean.js` from [Unmarked](https://github.com/Anonaconda-CodeLab/unmarked) (Anonaconda Code Lab) | 0.1.4, commit `695a6c5` | GPL-3.0-or-later |
| Instrument Sans typeface | | SIL Open Font License 1.1 ([src/fonts/OFL-InstrumentSans.txt](src/fonts/OFL-InstrumentSans.txt)) |
| IBM Plex Mono typeface | | SIL Open Font License 1.1 ([src/fonts/OFL-IBMPlexMono.txt](src/fonts/OFL-IBMPlexMono.txt)) |

pdf-lib's file also contains [@pdf-lib/standard-fonts](https://github.com/Hopding/standard-fonts) 1.0.0 (MIT,
[src/vendor/LICENSE-pdf-lib-standard-fonts.md](src/vendor/LICENSE-pdf-lib-standard-fonts.md)),
[UPNG](https://github.com/photopea/UPNG.js) as `@pdf-lib/upng` 1.0.1 (MIT, [src/vendor/LICENSE-upng.txt](src/vendor/LICENSE-upng.txt)),
[pako](https://github.com/nodeca/pako) 1.0.11 (MIT and zlib, [src/vendor/LICENSE-pako.txt](src/vendor/LICENSE-pako.txt)) and parts of
the TypeScript runtime library tslib (0BSD; its notice is kept in the file). Apache-2.0 components are compatible with the GPL v3 that covers Flatbed as a whole.

The **Android app** (built from `mobile/`) also includes:

| Component | Version | Licence |
|---|---|---|
| [Capacitor](https://capacitorjs.com) (`@capacitor/android`, `@capacitor/core`) | 8.5.3 | MIT |
| AndroidX libraries (AppCompat, Core, CoordinatorLayout, Core SplashScreen, Activity, WebKit) | see `mobile/android/variables.gradle` | Apache-2.0 |

Test images in `tests/fixtures/` were made with Pillow (`make-fixtures.py`) and the DejaVu and TLWG Loma fonts; the
tools and fonts themselves are not part of the app.

### Android app only
The APK adds these (web users don't get this code). Their texts are on the Licences screen in the Android app and in
`licences-android.txt` next to the page.

| Component | Version | Licence |
|---|---|---|
| [Capacitor](https://capacitorjs.com) (`@capacitor/android`, `@capacitor/core`) | 8.5.3 | MIT ([src/vendor/LICENSE-capacitor.txt](src/vendor/LICENSE-capacitor.txt)) |
| [Apache Cordova Android](https://cordova.apache.org) framework, used by Capacitor | 14.0.1 | Apache-2.0, with its NOTICE ([src/vendor/NOTICE-cordova.txt](src/vendor/NOTICE-cordova.txt)) |
| [AndroidX](https://developer.android.com/jetpack/androidx) libraries (appcompat, core, core-splashscreen, activity, fragment, coordinatorlayout, webkit) | see `mobile/android/variables.gradle` | Apache-2.0 |
| [Kotlin](https://kotlinlang.org) standard library, used by AndroidX | | Apache-2.0 |
