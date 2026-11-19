// Smoke test model NYATA (Node, onnxruntime-web 1.31.1) — BUKAN bagian dari
// `npm run verify` (inferensi ORMBG 1024px di WASM lambat). Jalankan manual:
//   node tests/model-smoke.mjs
// Model diambil dari tests/fixtures/models/ (lokal saja, tidak di-push).
// Memverifikasi: nama input/output + shape tiap model, konvensi mask
// Mi-GAN (polaritas A vs B, empiris — bukan dari klaim dokumen), dan
// kewarasan output (ORMBG: mask subjek vs latar; Real-ESRGAN: 4x).
import * as ort from "onnxruntime-web";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = join(HERE, "fixtures/models");
const MIGAN = join(MODELS, "migan_pipeline_v2.onnx");
const ORMBG = join(MODELS, "ormbg_int8.onnx");
const ESRGAN = join(MODELS, "realesr-general-x4v3.onnx");

ort.env.wasm.numThreads = 1;

function makeImage(w, h, fn) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(x, y, w, h);
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { w, h, data };
}
function toCHWUint8(img) {
  const { w, h, data } = img;
  const out = new Uint8Array(3 * w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = data[i * 4]; out[w * h + i] = data[i * 4 + 1]; out[2 * w * h + i] = data[i * 4 + 2];
  }
  return out;
}
function toCHWFloat01(img) {
  const { w, h, data } = img;
  const out = new Float32Array(3 * w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = data[i * 4] / 255; out[w * h + i] = data[i * 4 + 1] / 255; out[2 * w * h + i] = data[i * 4 + 2] / 255;
  }
  return out;
}
function chwToRGB(chw, w, h) {
  const out = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    out[i * 3] = chw[i]; out[i * 3 + 1] = chw[w * h + i]; out[i * 3 + 2] = chw[2 * w * h + i];
  }
  return out;
}
function meanAbsDiff(a, b, w, h, region) {
  let s = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (region && !region(x, y)) continue;
    const i = (y * w + x) * 3;
    s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  return n ? s / n : 0;
}

let failures = 0;
function check(name, ok, detail = "") {
  console.log((ok ? "  PASS " : "  FAIL ") + name + (detail ? " — " + detail : ""));
  if (!ok) failures++;
}

for (const f of [MIGAN, ORMBG, ESRGAN]) {
  if (!existsSync(f)) { console.error("MISSING MODEL FILE:", f); process.exit(2); }
}

// ── 1. Mi-GAN ──
console.log("\n== Mi-GAN migan_pipeline_v2.onnx ==");
{
  const bytes = readFileSync(MIGAN);
  const t0 = Date.now();
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  console.log("  session create:", Date.now() - t0, "ms");
  console.log("  inputs:", session.inputNames, "outputs:", session.outputNames);
  // Gambar uji: kiri hitam, kanan putih; lubang 112x112 di tengah
  // (menyeberang batas hitam/putih) berisi KOTAK MERAH — isi asli yang
  // tidak bisa ditebak dari tepi lubang, jadi isi yang benar (lanjutan
  // hitam/putih) pasti beda jauh dari aslinya, dan polaritas salah
  // (lubang tidak berubah) pasti beda ~0 di dalam lubang.
  const W = 512, H = 512;
  const img = makeImage(W, H, (x, y) => {
    if (x >= 220 && x < 292 && y >= 220 && y < 292) return [255, 0, 0];
    return x < 256 ? [0, 0, 0] : [255, 255, 255];
  });
  const imgCHW = toCHWUint8(img);
  const imgRGB = chwToRGB(imgCHW, W, H);
  const inHole = (x, y) => x >= 200 && x < 312 && y >= 200 && y < 312;
  const outHole = (x, y) => !inHole(x, y);
  const maskA = new Uint8Array(W * H); // 255 = lubang
  const maskB = new Uint8Array(W * H); // 0 = lubang
  for (let i = 0; i < W * H; i++) { maskA[i] = inHole(i % W, (i / W) | 0) ? 255 : 0; maskB[i] = inHole(i % W, (i / W) | 0) ? 0 : 255; }
  const results = {};
  for (const [tag, mask] of [["A:255=hole", maskA], ["B:0=hole", maskB]]) {
    const feeds = {
      [session.inputNames[0]]: new ort.Tensor("uint8", imgCHW, [1, 3, H, W]),
      [session.inputNames[1]]: new ort.Tensor("uint8", mask, [1, 1, H, W]),
    };
    const t1 = Date.now();
    const out = await session.run(feeds);
    const dt = Date.now() - t1;
    const o = out[session.outputNames[0]];
    console.log(`  run ${tag}: ${dt} ms, output type=${o.type} dims=${JSON.stringify(o.dims)}`);
    const rgb = chwToRGB(o.data, W, H);
    const dOut = meanAbsDiff(rgb, imgRGB, W, H, outHole);
    const dIn = meanAbsDiff(rgb, imgRGB, W, H, inHole);
    console.log(`    diff luar lubang: ${dOut.toFixed(2)} | diff dalam lubang: ${dIn.toFixed(2)}`);
    results[tag] = { dOut, dIn, dt };
  }
  // Polaritas benar = luar lubang nyaris tidak berubah, dalam lubang berubah.
  const a = results["A:255=hole"], b = results["B:0=hole"];
  const aCorrect = a.dOut < 5 && a.dIn > 10;
  const bCorrect = b.dOut < 5 && b.dIn > 10;
  // Empiris: 255 = diketahui (known), 0 = lubang — sesuai riset, dan
  // markProcess inpaint-web (mask UI hitam + coretan putih -> 0 di lubang).
  check("mask polarity B (0=hole) benar", bCorrect, `dOut=${b.dOut.toFixed(2)} dIn=${b.dIn.toFixed(2)}`);
  check("mask polarity A (255=hole) salah", !aCorrect, `dOut=${a.dOut.toFixed(2)} dIn=${a.dIn.toFixed(2)}`);
  // Ukuran non-512: model pipeline harus menerima ukuran arbitrer (crop internal).
  const W2 = 640, H2 = 480;
  const img2 = makeImage(W2, H2, (x, y) => (x < 320 ? [20, 20, 20] : [230, 230, 230]));
  const mask2 = new Uint8Array(W2 * H2);
  for (let y = 260; y < 340; y++) for (let x = 280; x < 360; x++) mask2[y * W2 + x] = 255;
  const t2 = Date.now();
  const out2 = await session.run({
    [session.inputNames[0]]: new ort.Tensor("uint8", toCHWUint8(img2), [1, 3, H2, W2]),
    [session.inputNames[1]]: new ort.Tensor("uint8", mask2, [1, 1, H2, W2]),
  });
  const o2 = out2[session.outputNames[0]];
  console.log(`  run 640x480: ${Date.now() - t2} ms, output dims=${JSON.stringify(o2.dims)}`);
  check("input non-512 diterima, output sama ukuran", JSON.stringify(o2.dims) === JSON.stringify([1, 3, H2, W2]));
}

// ── 2. ORMBG int8 ──
console.log("\n== ORMBG onnx/model_quantized.onnx (int8) ==");
{
  const bytes = readFileSync(ORMBG);
  const t0 = Date.now();
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  console.log("  session create:", Date.now() - t0, "ms");
  console.log("  inputs:", session.inputNames, "outputs:", session.outputNames);
  // Subjek: lingkaran merah di atas latar biru, 1024x1024.
  const W = 1024, H = 1024;
  const img = makeImage(W, H, (x, y) => {
    const dx = x - 512, dy = y - 512;
    return dx * dx + dy * dy < 300 * 300 ? [200, 40, 40] : [30, 80, 200];
  });
  const t1 = Date.now();
  const out = await session.run({
    [session.inputNames[0]]: new ort.Tensor("float32", toCHWFloat01(img), [1, 3, H, W]),
  });
  console.log("  run:", Date.now() - t1, "ms");
  const o = out[session.outputNames[0]];
  console.log("  output type:", o.type, "dims:", JSON.stringify(o.dims));
  const d = o.data;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < d.length; i++) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
  console.log("  output range:", mn.toFixed(3), "..", mx.toFixed(3));
  // Logit atau probabilitas? Kalau range keluar [0,1] -> sigmoid.
  const isLogit = mn < 0 || mx > 1;
  let inside = 0, ni = 0, outside = 0, no = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = d[y * W + x];
    const p = isLogit ? 1 / (1 + Math.exp(-v)) : v;
    const r2 = (x - 512) ** 2 + (y - 512) ** 2;
    if (r2 < 250 * 250) { inside += p; ni++; }
    else if (r2 > 350 * 350) { outside += p; no++; }
  }
  const mi = inside / ni, mo = outside / no;
  console.log(`  mask rata-rata: dalam subjek=${mi.toFixed(3)} luar subjek=${mo.toFixed(3)} (logit=${isLogit})`);
  check("mask subjek tinggi, latar rendah", mi > 0.7 && mo < 0.3, `in=${mi.toFixed(3)} out=${mo.toFixed(3)}`);
}

// ── 3. Real-ESRGAN General x4v3 ──
console.log("\n== Real-ESRGAN realesr-general-x4v3.onnx ==");
{
  const bytes = readFileSync(ESRGAN);
  const t0 = Date.now();
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  console.log("  session create:", Date.now() - t0, "ms");
  console.log("  inputs:", session.inputNames, "outputs:", session.outputNames);
  const W = 128, H = 128;
  const img = makeImage(W, H, (x, y) => {
    const g = ((x * 7 + y * 13) % 256);
    return [g, (g + 80) % 256, 200 - ((x + y) % 60)];
  });
  const t1 = Date.now();
  const out = await session.run({
    [session.inputNames[0]]: new ort.Tensor("float32", toCHWFloat01(img), [1, 3, H, W]),
  });
  console.log("  run:", Date.now() - t1, "ms");
  const o = out[session.outputNames[0]];
  console.log("  output type:", o.type, "dims:", JSON.stringify(o.dims));
  check("output 4x (512x512)", JSON.stringify(o.dims) === JSON.stringify([1, 3, 512, 512]));
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < o.data.length; i++) { if (o.data[i] < mn) mn = o.data[i]; if (o.data[i] > mx) mx = o.data[i]; }
  console.log("  output range:", mn.toFixed(3), "..", mx.toFixed(3));
  // Real-ESRGAN tidak meng-clamp output (overshoot normal) — implementasi
  // wajib clamp ke [0,1] saat encode ke uint8.
  check("output dalam rentang wajar (clamp saat encode)", mn >= -0.5 && mx <= 1.5, `${mn.toFixed(2)}..${mx.toFixed(2)}`);
  // Bukan sekadar nearest-neighbor: bandingkan dengan upscale bilinear sederhana
  // di satu baris — output model harus berbeda nyata dari interpolasi naif.
  const outRGB = chwToRGB(new Uint8Array(Array.from(o.data, (v) => Math.max(0, Math.min(255, Math.round(v * 255))))), 512, 512);
  const inRGB = chwToRGB(toCHWUint8(img), W, H);
  // naive 4x nearest: piksel (4x,4y) == input (x,y)
  let same = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const oi = ((4 * y) * 512 + 4 * x) * 3, ii = (y * W + x) * 3;
    if (Math.abs(outRGB[oi] - inRGB[ii]) < 2 && Math.abs(outRGB[oi + 1] - inRGB[ii + 1]) < 2) same++;
    n++;
  }
  console.log(`  piksel identik nearest-neighbor: ${same}/${n}`);
  check("output bukan nearest-neighbor murni", same / n < 0.9, `${((same / n) * 100).toFixed(1)}% sama`);
}

console.log(failures ? `\nSMOKE: ${failures} KEGAGALAN` : "\nSMOKE: SEMUA LULUS");
process.exit(failures ? 1 : 0);
