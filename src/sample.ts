/* Foto contoh — digenerate DI RUNTIME (canvas + injeksi chunk tEXt PNG),
   jadi tidak ada file biner baru di repo (snapshot push tidak bisa
   mengirim biner). Fotonya sengaja BERLABEL AI (tEXt "Software:
   OpenAI DALL·E") supaya alat Bersihkan langsung menemukan label saat
   dicoba. Dipakai tombol "Coba foto contoh" di home: file cuma
   file contoh = upload biasa dari home; alat default Bersihkan jalan
   otomatis (file-first, perintah Bobby 19 Nov 2026 19:14 WIB). */

var CRC_TABLE: number[] | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  var crc = 0xffffffff;
  for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function textChunk(keyword: string, value: string): Uint8Array {
  var enc = new TextEncoder();
  var kw = enc.encode(keyword);
  var val = enc.encode(value);
  var data = new Uint8Array(kw.length + 1 + val.length);
  data.set(kw, 0);
  data[kw.length] = 0;
  data.set(val, kw.length + 1);
  var type = enc.encode("tEXt");
  var out = new Uint8Array(12 + data.length);
  var dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(type, 4);
  out.set(data, 8);
  var crcIn = new Uint8Array(4 + data.length);
  crcIn.set(type, 0);
  crcIn.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcIn));
  return out;
}

/* Sisipkan chunk tEXt tepat setelah IHDR (chunk pertama PNG). */
function injectTextChunks(png: ArrayBuffer, chunks: Uint8Array[]): ArrayBuffer {
  var bytes = new Uint8Array(png);
  // PNG: 8 byte signature + IHDR chunk (4 len + 4 type + 13 data + 4 crc = 25).
  var ihdrEnd = 8 + 25;
  var extra = 0;
  chunks.forEach(function (c) { extra += c.length; });
  var out = new Uint8Array(bytes.length + extra);
  out.set(bytes.subarray(0, ihdrEnd), 0);
  var off = ihdrEnd;
  chunks.forEach(function (c) { out.set(c, off); off += c.length; });
  out.set(bytes.subarray(ihdrEnd), off);
  return out.buffer;
}

function drawSample(): Promise<Blob> {
  return new Promise(function (resolve, reject) {
    var W = 800, H = 600;
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var x = cv.getContext("2d");
    if (!x) { reject(new Error("canvas tidak tersedia")); return; }
    // Langit: gradien biru lembut -> hangat (golden hour).
    var sky = x.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#7FB2E8");
    sky.addColorStop(0.55, "#F6C98B");
    sky.addColorStop(1, "#F2A65E");
    x.fillStyle = sky;
    x.fillRect(0, 0, W, H);
    // Matahari.
    x.fillStyle = "#FFF3D6";
    x.beginPath(); x.arc(590, 170, 62, 0, Math.PI * 2); x.fill();
    x.fillStyle = "rgba(255,243,214,.35)";
    x.beginPath(); x.arc(590, 170, 92, 0, Math.PI * 2); x.fill();
    // Bukit jauh + dekat.
    x.fillStyle = "#7A9B6D";
    x.beginPath(); x.moveTo(0, 420); x.bezierCurveTo(180, 330, 380, 460, 800, 380); x.lineTo(800, 600); x.lineTo(0, 600); x.closePath(); x.fill();
    x.fillStyle = "#4E7A45";
    x.beginPath(); x.moveTo(0, 500); x.bezierCurveTo(220, 420, 520, 540, 800, 470); x.lineTo(800, 600); x.lineTo(0, 600); x.closePath(); x.fill();
    // Pohon sederhana.
    x.fillStyle = "#2F5D33";
    [[150, 470], [640, 500], [330, 520]].forEach(function (p) {
      x.fillRect(p[0] - 4, p[1], 8, 42);
      x.beginPath(); x.arc(p[0], p[1] - 18, 34, 0, Math.PI * 2); x.fill();
    });
    // Burung.
    x.strokeStyle = "rgba(40,40,40,.75)"; x.lineWidth = 3; x.lineCap = "round";
    [[240, 150], [300, 120], [350, 165]].forEach(function (p) {
      x.beginPath(); x.moveTo(p[0] - 12, p[1]); x.quadraticCurveTo(p[0] - 4, p[1] - 9, p[0], p[1]); x.quadraticCurveTo(p[0] + 4, p[1] - 9, p[0] + 12, p[1]); x.stroke();
    });
    // Teks kecil di pojok (bagian dari gambar, bukan watermark).
    x.fillStyle = "rgba(255,255,255,.9)";
    x.font = "600 26px system-ui, sans-serif";
    x.fillText("Foto contoh — senja di bukit", 28, H - 30);
    cv.toBlob(function (b) {
      if (b) resolve(b);
      else reject(new Error("gagal membuat PNG contoh"));
    }, "image/png");
  });
}

export async function makeSampleFile(): Promise<File> {
  var blob = await drawSample();
  var buf = await blob.arrayBuffer();
  var labeled = injectTextChunks(buf, [
    textChunk("Software", "OpenAI DALL·E"),
    textChunk("parameters", "prompt: a sunny hillside at golden hour, 35mm photo"),
  ]);
  return new File([labeled], "foto-contoh-ai.png", { type: "image/png" });
}
