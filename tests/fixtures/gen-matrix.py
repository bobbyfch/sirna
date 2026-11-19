# Generator matriks label 23 kasus (verifikasi fix 8052eebb, direkonstruksi
# dari ~/workspace/sirna-diagnosis-2026-11-18.md §2 — skrip aslinya di /tmp
# ikut ter-wipe). Setiap file membawa label OpenAI/DALL·E + manifest C2PA
# di SATU container; sesudah dibersihkan Sirna, re-scan harus 0 label
# (pill "Sudah bersih"). 12 PNG + 10 JPEG + 1 PNG-bernama-JPEG = 23.
# Dijalankan: python3 tests/fixtures/gen-matrix.py -> tests/fixtures/matrix/
import os, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "matrix")
os.makedirs(OUT, exist_ok=True)

MANIFEST = b"OpenAI DALL-E c2pa jumbf trainedAlgorithmicMedia iptc prompt: five chibi girls walking seed 42"
MANIFEST_TXT = "OpenAI DALL-E c2pa jumbf trainedAlgorithmicMedia iptc prompt: five chibi girls walking seed 42"

def png_chunk(typ, data):
    return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)

def base_png(w=400, h=300):
    # PNG minimal valid: IHDR + satu IDAT (gradien halus, terkompres) + IEND.
    from PIL import Image
    import io
    im = Image.new("RGB", (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = (x * 255 // (w - 1), y * 255 // (h - 1), 128)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()

def split_png(data):
    # -> (signature, [chunks (type, data)], trailing setelah IEND)
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos = 8
    chunks = []
    while pos + 8 <= len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunks.append((typ, data[pos + 8:pos + 8 + ln]))
        pos += 12 + ln
        if typ == b"IEND":
            break
    return data[:8], chunks, data[pos:]

def build_png(chunks, trailing=b""):
    out = b"\x89PNG\r\n\x1a\n"
    for typ, d in chunks:
        out += png_chunk(typ, d)
    return out + trailing

def base_jpeg():
    from PIL import Image
    import io
    im = Image.new("RGB", (400, 300), (120, 130, 140))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    return buf.getvalue()

def jpeg_segments(data):
    # -> (SOI, [(marker, payload)], SOS+scan+EIO blob)
    assert data[:2] == b"\xff\xd8"
    pos = 2
    segs = []
    while pos + 4 <= len(data):
        if data[pos] != 0xFF:
            break
        marker = data[pos + 1]
        if marker == 0xDA:  # SOS: sisanya scan data sampai EOI
            return data[:2], segs, data[pos:]
        if marker == 0xD9:
            return data[:2], segs, data[pos:]
        ln = struct.unpack(">H", data[pos + 2:pos + 4])[0]
        segs.append((marker, data[pos + 4:pos + 2 + ln]))
        pos += 2 + ln
    return data[:2], segs, data[pos:]

def jpeg_seg(marker, payload):
    return b"\xff" + bytes([marker]) + struct.pack(">H", len(payload) + 2) + payload

def build_jpeg(segs, tail):
    out = b"\xff\xd8"
    for m, p in segs:
        out += jpeg_seg(m, p)
    return out + tail

# ---------- PNG (12) ----------
_, pch, _ = split_png(base_png())
IDAT = [c for c in pch if c[0] == b"IDAT"]
IHDR = [c for c in pch if c[0] == b"IHDR"]
IEND = [(b"IEND", b"")]

def png_case(name, extra_chunks, trailing=b"", drop_idat=False):
    chunks = list(IHDR) + extra_chunks + ([] if drop_idat else list(IDAT)) + list(IEND)
    data = build_png(chunks, trailing)
    open(os.path.join(OUT, name), "wb").write(data)
    return data

# 1. tEXt Software + Parameters
png_case("png-text.png", [
    (b"tEXt", b"Software\x00OpenAI DALL-E"),
    (b"tEXt", b"Parameters\x00" + MANIFEST),
])
# 2. iTXt XMP
png_case("png-itxt.png", [
    (b"iTXt", b"XML:com.adobe.xmp\x00\x00\x00\x00\x00" + b"<x:xmpmeta xmlns:x='adobe:ns:meta/'>" + MANIFEST + b"</x:xmpmeta>"),
])
# 3. zTXt (teks terkompres — scanner buta, strip tetap buang)
png_case("png-ztxt.png", [
    (b"zTXt", b"Parameters\x00\x00" + zlib.compress(MANIFEST)),
])
# 4. eXIf (EXIF Software + XMP tag di dalam TIFF)
def make_exif():
    # TIFF LE minimal: IFD0 dengan Software + tag 0x02BC (XMP)
    xmp = b"<x:xmpmeta>" + MANIFEST + b"</x:xmpmeta>"
    soft = b"OpenAI DALL-E\x00"
    # header TIFF (8) + IFD0 (2 + 2*12 + 4) + data
    n = 2
    ifd_size = 2 + n * 12 + 4
    data_off = 8 + ifd_size
    soft_off = data_off
    xmp_off = data_off + len(soft)
    tiff = b"II*\x00" + struct.pack("<I", 8)
    tiff += struct.pack("<H", n)
    tiff += struct.pack("<HHI", 0x010F, 2, len(soft)) + struct.pack("<I", soft_off)
    tiff += struct.pack("<HHI", 0x02BC, 1, len(xmp)) + struct.pack("<I", xmp_off)
    tiff += struct.pack("<I", 0)
    tiff += soft + xmp
    return b"Exif\x00\x00" + tiff
png_case("png-exif.png", [(b"eXIf", make_exif())])
# 5. jumb (lowercase, + nested jumb)
png_case("png-jumb.png", [
    (b"jumb", b"\x00\x00\x00\x10jumb" + MANIFEST + b"\x00\x00\x00\x08jumb"),
])
# 6. tEXt setelah IEND (trailing)
png_case("png-trailing.png", [], trailing=png_chunk(b"tEXt", b"Software\x00OpenAI DALL-E"))
# 7. iCCP level-0 (stored — teks terlihat di raw bytes)
def make_iccp(level):
    # profil ICC minimal: header 128 byte + tag 'desc' berisi teks label
    desc_text = b"OpenAI DALL-E c2pa trainedAlgorithmicMedia\x00"
    desc = b"desc" + struct.pack(">I", 0) + struct.pack(">I", len(desc_text) + 12)
    desc += struct.pack(">I", len(desc_text)) + desc_text
    # tag table: 1 tag
    profile = bytearray(128 + 4 + 12 + len(desc))
    profile[0:4] = struct.pack(">I", len(profile))
    profile[4:8] = b"mntr"
    profile[8:12] = b"RGB "
    profile[128:132] = struct.pack(">I", 1)
    profile[132:136] = b"desc"
    profile[136:140] = struct.pack(">I", 128 + 4 + 12)
    profile[140:144] = struct.pack(">I", len(desc))
    profile[144:] = desc
    comp = zlib.compressobj(level)
    raw = bytes(profile)
    if level == 0:
        # level 0 = stored: teks tetap kebaca mentah di byte stream
        cdata = comp.compress(raw) + comp.flush()
    else:
        cdata = zlib.compress(raw, level)
    return b"ICC profile\x00\x00" + cdata
png_case("png-iccp0.png", [(b"iCCP", make_iccp(0))])
# 8. iCCP level-6 (terkompres — scanner buta)
png_case("png-iccp6.png", [(b"iCCP", make_iccp(6))])
# 9. JUMB (uppercase)
png_case("png-JUMB.png", [(b"JUMB", MANIFEST)])
# 10. c2pa (chunk kustom)
png_case("png-c2pa.png", [(b"c2pa", MANIFEST)])
# 11. abCD (chunk tak dikenal)
png_case("png-abCD.png", [(b"abCD", MANIFEST)])
# 12. kitchen-sink PNG
png_case("png-kitchen.png", [
    (b"tEXt", b"Software\x00OpenAI DALL-E"),
    (b"iTXt", b"XML:com.adobe.xmp\x00\x00\x00\x00\x00" + MANIFEST),
    (b"eXIf", make_exif()),
    (b"jumb", MANIFEST),
    (b"iCCP", make_iccp(0)),
    (b"JUMB", MANIFEST),
    (b"c2pa", MANIFEST),
    (b"abCD", MANIFEST),
])

# ---------- JPEG (10) ----------
_, jsegs, jtail = jpeg_segments(base_jpeg())
SOS = jtail  # SOS + scan + EOI

def jpeg_case(name, extra_segs, tail_extra=b""):
    data = build_jpeg(list(extra_segs) + list(jsegs), SOS + tail_extra)
    open(os.path.join(OUT, name), "wb").write(data)
    return data

# 1. APP1 EXIF (Software, UserComment prompt, ImageDescription)
def make_app1_exif():
    # TIFF LE: IFD0 Software + ImageDescription + ExifIFD UserComment
    soft = b"OpenAI DALL-E\x00"
    desc = b"Made with AI by OpenAI\x00"
    comment = b"ASCII\x00\x00\x00" + MANIFEST
    # layout: TIFF hdr(8) + IFD0(2+3*12+4=42) + ExifIFD(2+1*12+4=18) + data
    n0, n1 = 3, 1
    ifd0_size = 2 + n0 * 12 + 4
    exif_size = 2 + n1 * 12 + 4
    base = 8
    exif_off = base + ifd0_size
    data_off = exif_off + exif_size
    soft_off = data_off
    desc_off = data_off + len(soft)
    comm_off = data_off + len(soft) + len(desc)
    tiff = b"II*\x00" + struct.pack("<I", 8)
    tiff += struct.pack("<H", n0)
    tiff += struct.pack("<HHI", 0x010F, 2, len(soft)) + struct.pack("<I", soft_off)
    tiff += struct.pack("<HHI", 0x010E, 2, len(desc)) + struct.pack("<I", desc_off)
    tiff += struct.pack("<HHI", 0x8769, 4, 1) + struct.pack("<I", exif_off)
    tiff += struct.pack("<I", 0)
    tiff += struct.pack("<H", n1)
    tiff += struct.pack("<HHI", 0x9286, 7, len(comment)) + struct.pack("<I", comm_off)
    tiff += struct.pack("<I", 0)
    tiff += soft + desc + comment
    return b"Exif\x00\x00" + tiff
jpeg_case("jpg-app1-exif.jpg", [(0xE1, make_app1_exif())])
# 2. APP1 XMP
jpeg_case("jpg-app1-xmp.jpg", [(0xE1, b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta>" + MANIFEST + b"</x:xmpmeta>")])
# 3. APP11 JUMBF
jpeg_case("jpg-app11.jpg", [(0xEB, b"JUMBF" + MANIFEST)])
# 4. APP13 IPTC (Photoshop IRB 0x0404)
def make_app13():
    # Photoshop 3.0 IRB: "Photoshop 3.0\x00" + IRB 0x0404 (IPTC-NAA) berisi caption
    iptc = b"\x1c\x02\x78\x00" + MANIFEST  # 0x0278 = Caption/Abstract, len 0 -> pakai format panjang
    # format IPTC tag: 0x1C rec dataset len(2 byte); caption panjang >255 butuh len 2 byte (aman: MANIFEST ~100 byte)
    iptc = b"\x1c\x02\x78" + struct.pack(">H", len(MANIFEST)) + MANIFEST
    irb = struct.pack(">H", 0x0404) + b"8BIM\x04\x04\x00\x00" + struct.pack(">I", len(iptc)) + iptc
    if len(iptc) % 2:
        irb += b"\x00"
    return b"Photoshop 3.0\x00" + irb
jpeg_case("jpg-app13.jpg", [(0xED, make_app13())])
# 5. COM
jpeg_case("jpg-com.jpg", [(0xFE, b"Made with AI by OpenAI")])
# 6. APP12 Ducky / APP14 Adobe (kontrol — bukan label AI)
jpeg_case("jpg-app12-14.jpg", [(0xEC, b"Ducky\x00\x01\x02\x03"), (0xEE, b"Adobe\x00\x64\x00\x00\x00\x00\x00")])
# 7. APP2 ICC desc
def make_app2_icc(full=False):
    desc = (MANIFEST if full else b"OpenAI DALL-E c2pa trainedAlgorithmicMedia")
    # profil ICC minimal dengan tag desc
    desc_tag = b"desc" + struct.pack(">I", 0) + struct.pack(">I", len(desc) + 12 + 1)
    desc_tag += struct.pack(">I", len(desc) + 1) + desc + b"\x00"
    profile = bytearray(128 + 4 + 12 + len(desc_tag))
    profile[0:4] = struct.pack(">I", len(profile))
    profile[4:8] = b"mntr"
    profile[128:132] = struct.pack(">I", 1)
    profile[132:136] = b"desc"
    profile[136:140] = struct.pack(">I", 128 + 4 + 12)
    profile[140:144] = struct.pack(">I", len(desc_tag))
    profile[144:] = desc_tag
    return b"ICC_PROFILE\x00\x01\x01" + bytes(profile)
jpeg_case("jpg-icc-desc.jpg", [(0xE2, make_app2_icc(False))])
# 8. APP2 ICC full manifest
jpeg_case("jpg-icc-full.jpg", [(0xE2, make_app2_icc(True))])
# 9. trailing setelah EOI
jpeg_case("jpg-trailing.jpg", [], tail_extra=b"\nChatGPT openai c2pa trainedAlgorithmicMedia jumbf\n")
# 10. kitchen-sink JPEG
jpeg_case("jpg-kitchen.jpg", [
    (0xE1, make_app1_exif()),
    (0xE1, b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta>" + MANIFEST + b"</x:xmpmeta>"),
    (0xEB, b"JUMBF" + MANIFEST),
    (0xED, make_app13()),
    (0xFE, b"Made with AI by OpenAI"),
    (0xE2, make_app2_icc(True)),
])

# ---------- +1: PNG-bernama-JPEG (sniff magic bytes) ----------
data = build_jpeg([(0xE1, make_app1_exif())], SOS)
open(os.path.join(OUT, "png-named-jpeg.png"), "wb").write(data)

# ---------- Verifikasi generator: tiap file (kecuali kontrol) harus
# mengandung string label SEBELUM dibersihkan. Dua kasus terkompres
# (zTXt, iCCP level-6) memang buta buat scanner mentah — labelnya dicek
# setelah decompress, sesuai laporan diagnosis. ----------
import glob
def file_has_label(path):
    raw = open(path, "rb").read()
    if b"openai" in raw.lower():
        return True
    # zTXt / iCCP terkompres: decompress dulu
    if path.endswith(".png"):
        pos = 8
        while pos + 8 <= len(raw):
            ln = struct.unpack(">I", raw[pos:pos + 4])[0]
            typ = raw[pos + 4:pos + 8]
            payload = raw[pos + 8:pos + 8 + ln]
            try:
                if typ == b"zTXt":
                    nul = payload.index(b"\x00")
                    if b"openai" in zlib.decompress(payload[nul + 2:]).lower():
                        return True
                if typ == b"iCCP":
                    nul = payload.index(b"\x00")
                    if b"openai" in zlib.decompress(payload[nul + 2:]).lower():
                        return True
            except Exception:
                pass
            pos += 12 + ln
    return False
ok = 0
for path in sorted(glob.glob(os.path.join(OUT, "*"))):
    name = os.path.basename(path)
    raw = open(path, "rb").read()
    if name == "jpg-app12-14.jpg":
        good = b"openai" not in raw.lower()
        print(f"{name}: kontrol tanpa label -> {'OK' if good else 'SALAH (ada label!)'}")
        ok += 1 if good else 0
    else:
        good = file_has_label(path)
        print(f"{name}: {len(raw)} B, label -> {'OK' if good else 'SALAH (label tidak ketemu!)'}")
        ok += 1 if good else 0
print(f"matrix: {ok}/23 file generator OK -> {OUT}")

# ---------- Fixture smoke (bukan bagian dari 23): video + error path ----------
SMOKE = os.path.join(HERE, "smoke")
os.makedirs(SMOKE, exist_ok=True)

def mp4_box(typ, payload):
    return struct.pack(">I", 8 + len(payload)) + typ + payload

def minimal_mp4(label_bytes=b""):
    # ftyp + moov(mvhd) + mdat — cukup buat walkBoxes/scanVideoFile;
    # tidak perlu bisa diputar (kartu cuma scan box, bukan play).
    ftyp = mp4_box(b"ftyp", b"isom\x00\x00\x02\x00isomiso2")
    mvhd = b"\x00" * 100
    moov = mp4_box(b"moov", mp4_box(b"mvhd", mvhd))
    mdat = mp4_box(b"mdat", label_bytes or b"\x00" * 64)
    return ftyp + moov + mdat

# A8: label AI di dalam mdat (bukan box meta/udta) -> ketemu tapi tak bisa dibuang
open(os.path.join(SMOKE, "mp4-label-mdat.mp4"), "wb").write(
    minimal_mp4(b"OpenAI Sora c2pa jumbf " + b"\x00" * 200))
# no-op: MP4 bersih tanpa label & tanpa box metadata -> "Sudah bersih"
open(os.path.join(SMOKE, "mp4-clean.mp4"), "wb").write(minimal_mp4())
# A7: WebM minimal (EBML + Segment) -> cuma bisa dicek
open(os.path.join(SMOKE, "test.webm"), "wb").write(
    b"\x1a\x45\xdf\xa3\x42\x82\x84webm\x42\x87\x81\x01\x42\x85\x81\x02"
    b"\x18\x53\x80\x67\x01\x00\x00\x00\x00\x00\x00\x00")
# A6: file korup (nol byte, ekstensi .png) -> createImageBitmap gagal
open(os.path.join(SMOKE, "corrupt.png"), "wb").write(b"\x00" * 512)
# PNG besar berlabel (tEXt) buat jendela observasi pill awal di smoke test
from PIL import Image
import io
big = Image.new("RGB", (2400, 1800))
px = big.load()
for y in range(1800):
    for x in range(2400):
        px[x, y] = (x * 255 // 2399, y * 255 // 1799, 128)
buf = io.BytesIO()
big.save(buf, "PNG")
_, bch, _ = split_png(buf.getvalue())
big_data = build_png(list([c for c in bch if c[0] == b"IHDR"])
                     + [(b"tEXt", b"Software\x00OpenAI DALL-E")]
                     + [c for c in bch if c[0] == b"IDAT"]
                     + [(b"IEND", b"")])
open(os.path.join(SMOKE, "png-big.png"), "wb").write(big_data)
print(f"smoke fixtures -> {SMOKE} (mp4-label-mdat {os.path.getsize(os.path.join(SMOKE,'mp4-label-mdat.mp4'))} B, "
      f"mp4-clean, test.webm, corrupt.png, png-big.png {len(big_data)} B)")
