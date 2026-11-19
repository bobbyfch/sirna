/* Perbesar (interpolasi Lanczos) — dipakai sebagai fallback offline
   diam-diam saat model Real-ESRGAN tidak bisa diunduh, dan sebagai
   downscaler 4x -> 3x di dalam Web Worker AI (src/ai-worker.ts).
   Riset: ~/workspace/sirna-model-free-research-2026-11-19.md §1.
   Pipeline: Lanczos-3 (separable, windowed sinc) -> unsharp mask.
   BATAS JUJUR: interpolasi tidak menciptakan detail — ia hanya menata
   ulang piksel yang sudah ada. 2x di foto bersih cukup bagus buat medsos;
   3x mulai lembut; 4x = junk (tidak disediakan). Foto blur/rusak/noise
   berat tidak bisa diperbaiki — sharpening malah memperparah artefak.
   Memori: pass memakai buffer byte (bukan float) — 2x dari 1024 px
   ~12 MB output, aman di HP; 3x dibatasi input 768 px (lihat upscale.ts). */

export type Upscale = 2 | 3;

/* Lanczos-3 separable: tiap sumbu di-resample dengan kernel sinc
   ber-jendela (6 tap). Bobot dihitung sekali per fase output lalu dipakai
   ulang di semua baris/kolom — cepat untuk skala bulat (2x/3x). */
function lanczos(x: number): number {
  if (x === 0) return 1;
  if (Math.abs(x) >= 3) return 0;
  const pix = Math.PI * x;
  return (Math.sin(pix) / pix) * (Math.sin(pix / 3) / (pix / 3));
}

interface AxisMap {
  start: Int32Array; // indeks sumber pertama per posisi output
  weights: Float32Array; // 6 bobot per posisi output (sudah dinormalisasi)
}

function buildAxisMap(inLen: number, outLen: number, scale: number): AxisMap {
  const start = new Int32Array(outLen);
  const weights = new Float32Array(outLen * 6);
  for (let o = 0; o < outLen; o++) {
    const src = (o + 0.5) / scale - 0.5;
    const s0 = Math.floor(src) - 2;
    start[o] = s0;
    let sum = 0;
    for (let t = 0; t < 6; t++) {
      const w = lanczos(src - (s0 + t));
      weights[o * 6 + t] = w;
      sum += w;
    }
    // Normalisasi bobot (tepi gambar: tap di luar gambar dijepit ke piksel
    // tepi, jadi bobotnya tetap dihitung — kecerahan terjaga).
    for (let t = 0; t < 6; t++) weights[o * 6 + t] /= sum;
  }
  return { start, weights };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function resampleAxis(
  src: Uint8ClampedArray, inW: number, inH: number, horizontal: boolean, map: AxisMap, outLen: number
): Uint8ClampedArray {
  const outW = horizontal ? outLen : inW;
  const outH = horizontal ? inH : outLen;
  const inLen = horizontal ? inW : inH;
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const o = horizontal ? x : y;
      const s0 = map.start[o];
      const wOff = o * 6;
      let r = 0, g = 0, b = 0, a = 0;
      for (let t = 0; t < 6; t++) {
        const w = map.weights[wOff + t];
        if (w === 0) continue;
        let si = s0 + t;
        if (si < 0) si = 0;
        else if (si >= inLen) si = inLen - 1;
        const idx = horizontal ? (y * inW + si) * 4 : (si * inW + x) * 4;
        r += src[idx] * w;
        g += src[idx + 1] * w;
        b += src[idx + 2] * w;
        a += src[idx + 3] * w;
      }
      const oi = (y * outW + x) * 4;
      out[oi] = clampByte(r);
      out[oi + 1] = clampByte(g);
      out[oi + 2] = clampByte(b);
      out[oi + 3] = clampByte(a);
    }
  }
  return out;
}

/* Unsharp mask: blur kotak 3x3 lalu tambah selisihnya kembali
   (amount 0,65 — acuan riset: radius 0,5–1,0, amount 50–80%). */
function unsharp(img: ImageData, amount = 0.65): ImageData {
  const { width: w, height: h, data: d } = img;
  const out = new ImageData(new Uint8ClampedArray(d), w, h);
  const od = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            sum += d[(yy * w + xx) * 4 + c];
            n++;
          }
        }
        const blur = sum / n;
        od[i + c] = clampByte(d[i + c] + (d[i + c] - blur) * amount);
      }
      od[i + 3] = d[i + 3];
    }
  }
  return out;
}

/* Perbesar ImageData 2x/3x: Lanczos-3 (horizontal lalu vertikal) +
   unsharp mask. */
export function lanczosUpscale(img: ImageData, scale: Upscale): ImageData {
  const { width: w, height: h, data: d } = img;
  const ow = w * scale, oh = h * scale;
  const xMap = buildAxisMap(w, ow, scale);
  const mid = resampleAxis(d, w, h, true, xMap, ow);
  const yMap = buildAxisMap(h, oh, scale);
  const full = resampleAxis(mid, ow, h, false, yMap, oh);
  return unsharp(new ImageData(new Uint8ClampedArray(full), ow, oh));
}

/* ── Resample umum (dipakai worker Real-ESRGAN: 4x -> 3x) ──
   Sama seperti lanczosUpscale tapi skalanya bebas, termasuk DOWNSCALE.
   Saat downscale (scale < 1) kernel dilebarkan 1/scale dan tap-nya
   ditambah — kalau tidak, frekuensi tinggi ikut lolos dan jadi moiré.
   Tanpa unsharp: dipakai pada output model yang sudah tajam. */
interface GenAxisMap {
  taps: number;
  start: Int32Array;
  weights: Float32Array;
}

function buildGenAxisMap(inLen: number, outLen: number): GenAxisMap {
  const scale = outLen / inLen;
  const support = scale >= 1 ? 3 : 3 / scale;
  const taps = Math.max(6, Math.ceil(support * 2));
  const start = new Int32Array(outLen);
  const weights = new Float32Array(outLen * taps);
  for (let o = 0; o < outLen; o++) {
    const src = (o + 0.5) / scale - 0.5;
    const s0 = Math.floor(src - support + 1);
    start[o] = s0;
    let sum = 0;
    for (let t = 0; t < taps; t++) {
      const w = scale >= 1 ? lanczos(src - (s0 + t)) : lanczos((src - (s0 + t)) * scale);
      weights[o * taps + t] = w;
      sum += w;
    }
    for (let t = 0; t < taps; t++) weights[o * taps + t] /= sum;
  }
  return { taps, start, weights };
}

function resampleAxisGen(
  src: Uint8ClampedArray, inW: number, inH: number, horizontal: boolean, map: GenAxisMap, outLen: number,
): Uint8ClampedArray {
  const outW = horizontal ? outLen : inW;
  const outH = horizontal ? inH : outLen;
  const inLen = horizontal ? inW : inH;
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const o = horizontal ? x : y;
      const s0 = map.start[o];
      const wOff = o * map.taps;
      let r = 0, g = 0, b = 0, a = 0;
      for (let t = 0; t < map.taps; t++) {
        const w = map.weights[wOff + t];
        if (w === 0) continue;
        let si = s0 + t;
        if (si < 0) si = 0;
        else if (si >= inLen) si = inLen - 1;
        const idx = horizontal ? (y * inW + si) * 4 : (si * inW + x) * 4;
        r += src[idx] * w;
        g += src[idx + 1] * w;
        b += src[idx + 2] * w;
        a += src[idx + 3] * w;
      }
      const oi = (y * outW + x) * 4;
      out[oi] = clampByte(r);
      out[oi + 1] = clampByte(g);
      out[oi + 2] = clampByte(b);
      out[oi + 3] = clampByte(a);
    }
  }
  return out;
}

export function lanczosResample(img: ImageData, newW: number, newH: number): ImageData {
  const { width: w, height: h, data: d } = img;
  if (newW === w && newH === h) return new ImageData(new Uint8ClampedArray(d), w, h);
  const xMap = buildGenAxisMap(w, newW);
  const mid = resampleAxisGen(d, w, h, true, xMap, newW);
  const yMap = buildGenAxisMap(h, newH);
  const full = resampleAxisGen(mid, newW, h, false, yMap, newH);
  return new ImageData(new Uint8ClampedArray(full), newW, newH);
}
