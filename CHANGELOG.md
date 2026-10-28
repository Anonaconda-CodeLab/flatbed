# Changelog

## 1.0.0
The launch version, with the Android app announced. Fixes from a private security review, and the latest cleaner.
- **Picture-size limit:** a photo is checked from its file header before it is opened, and a picture over 100
  megapixels is refused with a clear message. A small file can claim enormous dimensions (a one-colour 40000 × 40000
  picture fits in a few MB), and opening it could crash the page or the app.
- **Cleaner from Unmarked 0.1.4:** every PDF is checked with the newest version (digital signatures, XFA form
  scripts, form buttons that send data, article threads, rarer image data, compressed data over 64 MB, bounded text
  scans).
- **Android app:** Share → Flatbed accepts only files offered by other apps, never Flatbed's own; a PDF can be written
  only to the place chosen in Android's save screen; a file over the 60 MB limit is refused before it is read; and
  the camera's last photo and the last shared PDFs are cleared when the app starts, instead of waiting for Android
  to clear its cache.
- Manual: some camera apps keep their own copy of a photo in the gallery; the size limits.
- New donation line: "No ads, no tracking. If you find this app useful, please consider making a small donation to
  help fund development. Thank you!"
- Release builds: the APK is built without access to the signing key or to write access on GitHub, signed in a
  separate step that waits for the owner's approval, and published in a third. Pushing a tag no longer starts a
  build. GitHub Actions are pinned to exact commits; CodeRabbit reviews pull requests.

## 0.1.0
- First version. Scans documents into PDFs entirely on the device: take photos (a live camera view that outlines the
  page) or import them, and Flatbed finds the page, corrects the perspective, straightens the text and cleans it up.
- Corners can be dragged by hand, with a magnifier. Looks: Original, Enhanced, Grey, Black & white, with a contrast
  slider; turn by 90°. Several pages, reordered with arrows.
- Text recognition, fully offline, in English, French, Spanish, German and Thai: searchable PDFs with an invisible text
  layer, or image-only PDFs. Copy the text, or save it as a .txt file.
- Private by default: a panel lists what the PDF leaves out (the photos' location, phone and dates; author, app name,
  dates and document IDs; the surroundings of the page). Every PDF is cleaned with Unmarked's cleaner and checked.
- Page size A4, Letter or the shape of the scan; your own file name.
- Free, with no ads or tracking: a Ko-fi link in About, and a gentle request after 20, 50 and 100 PDFs.
- Android app: the phone's own camera app takes the photos, Share → Flatbed from the gallery, saving and sharing through
  Android's own screens. No internet permission and no camera permission.
