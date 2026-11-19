# Regenerasi fixture gambar buat e2e (persisten, di tests/fixtures/).
# erase-test.png: 800x600 gradien HALUS (R=x*255/799, G=y*255/599, B=128)
#   + lingkaran merah r=60 di (400,300) + kotak hijau (60..200, 420..500).
# PENTING: gradien harus halus — (x%256, y%256) bikin garis keras di
# x=256/512/768 & y=256/512 (wrap) yang dideteksi sebagai watermark
# (false positive; ketemu 2026-11-18 saat regresi watermark e2e).
# wm-test.png: base yang sama + sparkle putih (742,545) + badge putih
#   "Made with AI" (24..168, 544..576). wm-clean.png: base tanpa watermark.
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))


def base():
    W, H = 800, 600
    im = Image.new("RGB", (W, H))
    px = im.load()
    for y in range(H):
        for x in range(W):
            px[x, y] = (x * 255 // (W - 1), y * 255 // (H - 1), 128)
    d = ImageDraw.Draw(im)
    d.ellipse([400 - 60, 300 - 60, 400 + 60, 300 + 60], fill=(220, 30, 30))
    d.rectangle([60, 420, 200, 500], fill=(30, 180, 60))
    return im


def sparkle(d, cx, cy, r=13):
    # bintang 4 ujung putih: belah ketupat + silang. Pinggang +-3 & silang
    # width 3: cukup tajam supaya edgeFrac detektor >= 0.30 (pinggang +-4
    # + width 3 jatuh di 0.296 — sparkle putih di latar terang nyaris
    # tidak kontras, jadi bentuknya harus setajam ini).
    d.polygon([(cx, cy - r), (cx + 3, cy - 3), (cx + r, cy), (cx + 3, cy + 3),
               (cx, cy + r), (cx - 3, cy + 3), (cx - r, cy), (cx - 3, cy - 3)],
              fill=(255, 255, 255))
    d.line([cx - r, cy, cx + r, cy], fill=(255, 255, 255), width=3)
    d.line([cx, cy - r, cx, cy + r], fill=(255, 255, 255), width=3)


def badge(im):
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([24, 544, 168, 576], radius=8, fill=(255, 255, 255))
    try:
        f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
    except Exception:
        f = ImageFont.load_default()
    d.text((30, 551), "Made with AI", fill=(30, 30, 30), font=f)
    return im


erase = base()
erase.save(os.path.join(HERE, "erase-test.png"))

wm = base()
d = ImageDraw.Draw(wm)
sparkle(d, 742, 545)
wm = badge(wm)
wm.save(os.path.join(HERE, "wm-test.png"))

clean = base()
clean.save(os.path.join(HERE, "wm-clean.png"))
print("fixtures done")
