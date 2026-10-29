# Flatbed user manual

## What Flatbed does

Flatbed turns photos of documents into clean, flat, readable PDFs. Photograph a letter, a form, a receipt or an ID
card, and Flatbed finds the page, corrects the angle, straightens the text, cleans up shadows, reads the text and puts
it all in a PDF that you can search and copy from.

Everything happens **on your device**. Your pages are never uploaded anywhere, and nothing is kept once you close the
app.

> A scanner sees your most private papers: passports, bank letters, contracts, medical results. Most scanner apps send
> them to their own servers to read the text. Flatbed can't: it has no way to connect to the internet at all.

## Why scan with Flatbed

- **Passport and ID copies.** A visa application, a new rental, a school or a job often asks for a copy of your passport
  or ID card. With Flatbed that copy is made and kept on your phone only, and goes only where you send it.
- **Money and work.** Bank letters, tax forms, payslips and contracts are read and turned into a PDF right here,
  without an account and without anyone else's server seeing the numbers.
- **Health.** Prescriptions, test results and insurance claims stay between you and whoever you choose to send them to.
- **Receipts and expense claims.** The PDF holds the receipt and nothing else: no phone model, no location, no date and
  time of the photo.
- **Documents for strangers.** Landlords, employers, agencies and online forms get the pages you meant to send, not
  details about you or your phone.

## How to scan

1. Tap **Take a photo**, or **Import photos** to use pictures you already have. You can add pages one after another.
[[android]]
   In the Android app, **Take a photo** opens your phone's own camera app. Flatbed itself has no camera permission.
   You can also share photos to Flatbed from your gallery (**Share → Flatbed**).
[[/android]]
2. Flatbed looks for the edges of the page in each photo, flattens it as if it had been on a scanner's glass, and
   levels the lines of text. The pages appear in a list.
3. Tap a page to adjust it (see below). Use the arrows under a page to change the order.
4. Tap **Make PDF**, choose the options, and tap **Make PDF** again.
5. **Save** or **Share** the PDF. You can also copy the recognised text, or save it as a plain text file.
   In Chrome or Edge on a computer, **Save** lets you choose the folder and the name. Other browsers save to their
   Downloads folder, but most can ask each time instead: in Chrome on Android, turn on **Ask where to save files** in
   Chrome's settings, under **Downloads**; in Firefox on a computer, choose **Always ask you where to save files** in
   Settings, under **Files and Applications**. Firefox on Android always uses the Downloads folder; **Share** sends
   the PDF straight to another app instead.[[android]] In the Android app, Save always lets you choose.[[/android]]

### Taking a good photo

- **Light:** daylight or a bright room, without the flash. Avoid your own shadow falling across the page.
- **Background:** a page shows up best on a darker surface (a wooden table rather than a white desk).
- **Angle:** hold the phone roughly above the page. Flatbed corrects a fair amount of tilt, but the sharper the text,
  the better it can be read.
- **Whole page:** keep all four corners in the picture.

In the web app, the camera view outlines the page in orange when it has found it.

Photos can be up to 60 MB and 100 megapixels each (a phone camera's usual photos are well under both), and a PDF can
have up to 60 pages. If your camera has a special very-high-resolution mode, use its normal mode for scanning.

## Adjusting a page

**Crop.** Drag the four corners to the corners of the page. While you drag, a magnifier shows exactly where the
corner is. **Find the page** looks for the edges again; **Use the whole photo** keeps everything (useful for a
screenshot or a photo that is already cropped).

**Adjust.** Choose how the page looks:

- **Original:** the colours as photographed.
- **Enhanced** (the default): white paper and clear ink, with shadows and uneven light removed, colours kept. Good for
  most documents, stamps and coloured forms.
- **Grey:** the same, in shades of grey.
- **Black & white:** pure black text on white. The sharpest and smallest PDF for plain text documents; not for photos.

**Light text on a dark page** (a black card, a slide, a screen in dark mode) keeps its look: Flatbed recognises it and
cleans it up the same way, so the page stays dark and the text light. The text is read as usual. For printing, turn on
**Black text on white**, which appears under Adjust for such pages only: the page becomes white with black text, and
colours keep their hue (a blue logo stays blue). Original always stays as photographed. If a PDF would have dark pages,
the PDF screen says so, with a button to change them.

The **Contrast** (or **Text darkness**) slider makes the result lighter or darker. **Turn left** and **Turn right**
rotate the page. **Straighten text lines** levels a page whose lines are slightly tilted; turn it off for a page with
no lines of text, such as a drawing.

## Making the PDF

**Page size.** A4, Letter, or **Same as the scan** (the page keeps the shape of what you photographed, such as a
receipt or a card). The default follows your device's region.

**Text.**
- **Searchable PDF:** Flatbed reads the text and adds it to the PDF as an invisible layer behind the picture. You can
  then search the PDF, and select and copy its text. The reading happens on your device and takes a few seconds per
  page.
- **Image-only PDF (no text layer):** only the pictures of the pages. Choose this when you'd rather the text couldn't be
  copied or searched easily, for example for an ID card. (Anyone can still read what they can see.)

**Language.** Choose the language of the document, up to two at a time: English, French, Spanish, German and Thai are
built in. Choosing the right language matters: it is how Flatbed knows which letters and words to expect.

**File name.** The PDF is called `scan.pdf` unless you choose another name. Camera file names such as
`IMG_20261025_091233.jpg`, which give away the date and time, are never used.

### Reading text: what to expect

Clear, printed text on a flat, well-lit page is usually read almost perfectly. Results are weaker for small print
(some receipts), creased or curved pages, low light, unusual fonts, and tables or several columns. Handwriting isn't
read. Check important figures before relying on the recognised text.

Thai text has no spaces between words, so when you select text in the PDF, a "word" may cover more or less than you
expect.

## Privacy

Before you make a PDF, Flatbed shows a **Private by default** panel listing what it leaves out:

- **Hidden data in your photos.** Photos usually carry where they were taken, when, and which phone took them (see
  Unmarked, our app for cleaning photos and PDFs). Flatbed lists what your photos carried, and leaves all of it out: each
  page is redrawn from the picture alone, so nothing from the photo file is copied.
- **No author, app name or dates.** The PDF has no title, author, app name, or creation and change dates.
- **No document ID.** Nothing that could link the PDF to other files, to this app or to your phone.
- **The surroundings.** Only the page is kept; the table, your hands and the room are cut away.

Every PDF is also put through the same cleaner as Unmarked and **checked** before you can save it. The result appears
as *Checked: no hidden data in the PDF*.

**What Flatbed can't remove:** what's on the page itself. Names, numbers, signatures, photos and stamps on the
document are in the scan. Cover anything you don't want to send before you take the photo.

**Your camera app may keep its own copy.** When Flatbed hands over to your phone's camera app to take a photo, some
camera apps also save a copy in your gallery, with the place it was taken if your camera records locations. Flatbed
can't prevent that: delete the copy from your gallery if you don't want it, or turn off location in your camera app's
settings.

**No network, nothing stored.** The web app blocks every network connection[[android]], and the Android app has no
internet permission and no camera permission[[/android]]. Opening the web app is an ordinary visit to its website,
like any page; once it has loaded, nothing you scan is sent anywhere. Your pages are held in memory only, and are gone
when you close the app; the web app asks before you leave a page that still has scans on it. The only things
remembered on your device are your choices of page size, text and language, and a count of PDFs made (used only to
ask, now and then, whether you would like to support the app).

**Translating the page.** If you use your browser's *Translate* button, the browser sends the page's text to its
translation service (Google's, in Chrome). Flatbed marks your pages, the recognised text and your file name so the
translator leaves them out: only the app's own buttons and labels are translated.

[[android]]
## The Android app

Flatbed is also an Android app: the same app, with **Take a photo** using your phone's own camera app, **Share →
Flatbed** from your gallery, and saving and sharing through Android's own screens. It has **no internet permission and
no camera permission**. It is not on Google Play; download it from **flatbed.anonacondacodelab.com/android.html**, which also explains
how to install it and how to check that it's the official build. **About → Check for updates** tells you when a new
version is out.

[[/android]]
## No guarantee

Flatbed is free software provided as it is, without any warranty. Check the PDF before you send anything important.
You are responsible for what you share, and Anonaconda Code Lab accepts no liability for any loss or harm from using
this app.

## Support and feedback

Flatbed is free and open source, with no ads or tracking. If it's useful to you, you can support it on Ko-fi:
https://ko-fi.com/anonacondacodelab. Questions, problems or a language you'd like added: hello@anonacondacodelab.com.
A description or a screenshot of the app is usually enough; please don't send the documents you were scanning.
