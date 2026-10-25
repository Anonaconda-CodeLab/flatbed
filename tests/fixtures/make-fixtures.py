# Copyright (C) 2026 Anonaconda Code Lab · SPDX-License-Identifier: GPL-3.0-or-later
# Rebuilds the test images (Pillow): two lines of English and of Thai as gzipped PGM, and the English one as JPEG.
# Needs the DejaVu and TLWG Loma fonts (Debian/Ubuntu: fonts-dejavu-core, fonts-tlwg-loma-otf).
import gzip
from PIL import Image, ImageDraw, ImageFont

def pgm(name, lines, font, size):
    f = ImageFont.truetype(font, size)
    im = Image.new('L', (1500, 90 * len(lines) + 80), 255)
    d = ImageDraw.Draw(im)
    for i, t in enumerate(lines):
        d.text((50, 40 + 90 * i), t, font=f, fill=0)
    data = b'P5\n%d %d\n255\n' % im.size + im.tobytes()
    open(name + '.pgm.gz', 'wb').write(gzip.compress(data, 9, mtime=0))
    return im

en = pgm('text-en', ['Rental agreement for the flat', 'Monthly rent: 12,500 baht, due on the 5th'], '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 46)
pgm('text-th', ['สัญญาเช่าห้องพัก', 'ค่าเช่ารายเดือน'], '/usr/share/fonts/opentype/tlwg/Loma.otf', 52)
en.convert('RGB').save('page.jpg', quality=85)
