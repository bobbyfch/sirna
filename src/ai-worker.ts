/* Sirna — Web Worker inferensi AI (SATU engine per fitur, 19 Nov 2026).
   Dijalankan sebagai module worker via Vite (`new Worker(new URL(...))`).
   SATU onnxruntime-web (1.31.1) untuk ketiga engine; session dibuat
   sekali per engine dan di-cache di sini. WASM multi-thread SAJA —
   WebGPU tidak dipakai (jsep wasm 29,5 MB > batas 25 MiB/file
   Cloudflare Static Assets; lihat vite.config.ts).
   PENTING: impor dari "onnxruntime-web/wasm" (bundle WASM-only), BUKAN
   dari "onnxruntime-web" — bundle default (all-EP) memuat wasm JSEP
   (ort-wasm-simd-threaded.jsep.*) yang tidak ada di dist/ort/ dan
   tidak bisa di-deploy (29,5 MB). Bundle wasm-only memuat wasm
   threaded biasa (ort-wasm-simd-threaded.wasm/.mjs) yang disalin
   Vite ke dist/ort/.
   wasmPaths absolut dari origin root — file .wasm disalin Vite ke
   dist/ort/ saat build (lihat vite.config.ts, plugin sirna-ort-wasm).
   Kontrak I/O terverifikasi tests/model-smoke.mjs (Node, ORT 1.31.1):
   - Mi-GAN: input image uint8 [1,3,H,W] + mask uint8 [1,1,H,W]
     (255 = diketahui, 0 = lubang — TERBALIK dari kebanyakan tool),
     output result uint8 [1,3,H,W]. Ukuran arbitrer (crop 512 internal).
   - ORMBG: input pixel_values float32 [1,3,1024,1024] (RGB/255, tanpa
     normalisasi ImageNet), output alphas float32 [1,1,1024,1024] di
     [0,1] (sudah probabilitas — tanpa sigmoid).
   - Real-ESRGAN x4v3: input float32 [1,3,H,W] (/255), output float32
     [1,3,4H,4W] (TIDAK di-clamp — clamp ke [0,1] saat encode). */

import * as ort from "onnxruntime-web/wasm";
import { lanczosResample } from "./lanczos";

ort.env.wasm.wasmPaths = "/ort/";
try {
  ort.env.wasm.numThreads = Math.min(4, (self as unknown as { navigator: Navigator }).navigator?.hardwareConcurrency || 4);
} catch (_e) {
  ort.env.wasm.numThreads = 1;
}

type EngineId = "migan" | "ormbg" | "esrgan";

const sessions = new Map<EngineId, ort.InferenceSession>();
const providers = new Map<EngineId, string>();

async function loadSession(engine: EngineId, bytes: ArrayBuffer): Promise<void> {
  if (sessions.has(engine)) return;
  // WASM SAJA — WebGPU sengaja tidak dicoba: runtime WebGPU ORT
  // (ort-wasm-simd-threaded.jsep.wasm, 29,5 MB) melebihi batas
  // 25 MiB/file Cloudflare Workers Static Assets, jadi tidak bisa
  // ikut di-deploy. Upgrade path: host jsep wasm di R2 + CORS, baru
  // aktifkan WebGPU lagi. WASM multi-thread (numThreads di atas).
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  sessions.set(engine, session);
  providers.set(engine, "wasm");
}

/* ── Mi-GAN: image RGBA + mask (1 = lubang) -> RGBA hasil ── */
async function runInpaint(w: number, h: number, rgba: Uint8ClampedArray, mask: Uint8Array): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const session = sessions.get("migan");
  if (!session) throw new Error("Mi-GAN belum dimuat");
  const n = w * h;
  const img = new Uint8Array(3 * n);
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    img[i] = rgba[i * 4];
    img[n + i] = rgba[i * 4 + 1];
    img[2 * n + i] = rgba[i * 4 + 2];
    m[i] = mask[i] ? 0 : 255; // 0 = lubang, 255 = diketahui
  }
  const out = await session.run({
    image: new ort.Tensor("uint8", img, [1, 3, h, w]),
    mask: new ort.Tensor("uint8", m, [1, 1, h, w]),
  });
  const res = out.result as ort.Tensor;
  const chw = res.data as Uint8Array;
  const outRgba = new Uint8ClampedArray(4 * n);
  for (let i = 0; i < n; i++) {
    outRgba[i * 4] = chw[i];
    outRgba[i * 4 + 1] = chw[n + i];
    outRgba[i * 4 + 2] = chw[2 * n + i];
    outRgba[i * 4 + 3] = 255;
  }
  return { data: outRgba, w, h };
}

/* ── ORMBG: image RGBA 1024x1024 -> mask alpha float32 1024x1024 ── */
async function runBg(w: number, h: number, rgba: Uint8ClampedArray): Promise<{ data: Float32Array; w: number; h: number }> {
  const session = sessions.get("ormbg");
  if (!session) throw new Error("ORMBG belum dimuat");
  const n = w * h;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    input[i] = rgba[i * 4] / 255;
    input[n + i] = rgba[i * 4 + 1] / 255;
    input[2 * n + i] = rgba[i * 4 + 2] / 255;
  }
  const out = await session.run({
    pixel_values: new ort.Tensor("float32", input, [1, 3, h, w]),
  });
  const alphas = out.alphas as ort.Tensor;
  const mask = new Float32Array((alphas.data as Float32Array).length);
  mask.set(alphas.data as Float32Array);
  return { data: mask, w, h };
}

/* ── Real-ESRGAN x4v3: tiling 256px, overlap 32px, hasil langsung 2x/3x ──
   Model native 4x. Supaya tidak pernah mematerialisasi gambar 4x penuh
   (8192px = ratusan MB), tiap tile di-downscale ke skala akhir SEBELUM
   ditempel: 2x = rata-rata blok 2x2, 3x = Lanczos dari 4x. Tepi tile
   yang overlap dipotong (zona seam) — hanya bagian tengah tiap tile
   yang ditempel. Progress per tile. */
const TILE = 256;
const OVERLAP = 32;

function blockAverage2x(src: Float32Array, sw: number, sh: number): { data: Uint8ClampedArray; w: number; h: number } {
  const w = sw >> 1, h = sh >> 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            s += src[(c * sh + (2 * y + dy)) * sw + (2 * x + dx)];
          }
        }
        out[(y * w + x) * 4 + c] = Math.max(0, Math.min(255, Math.round((s / 4) * 255)));
      }
      out[(y * w + x) * 4 + 3] = 255;
    }
  }
  return { data: out, w, h };
}

async function runUpscale(
  w: number,
  h: number,
  rgba: Uint8ClampedArray,
  scale: 2 | 3,
  onTile: (done: number, total: number) => void,
): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const session = sessions.get("esrgan");
  if (!session) throw new Error("Real-ESRGAN belum dimuat");
  const outW = w * scale, outH = h * scale;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const stride = TILE - OVERLAP;
  const tilesX = Math.max(1, Math.ceil((w - OVERLAP) / stride));
  const tilesY = Math.max(1, Math.ceil((h - OVERLAP) / stride));
  const total = tilesX * tilesY;
  let done = 0;
  const n = w * h;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    input[i] = rgba[i * 4] / 255;
    input[n + i] = rgba[i * 4 + 1] / 255;
    input[2 * n + i] = rgba[i * 4 + 2] / 255;
  }
  // Crop di skala akhir (px): setengah overlap — zona seam dibuang.
  const cropFinal = Math.round((OVERLAP / 2) * scale);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = Math.min(tx * stride, w - TILE);
      const y0 = Math.min(ty * stride, h - TILE);
      const tw = Math.min(TILE, w - x0), th = Math.min(TILE, h - y0);
      const tileIn = new Float32Array(3 * tw * th);
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const si = (y0 + y) * w + (x0 + x);
          const di = y * tw + x;
          tileIn[di] = input[si];
          tileIn[tw * th + di] = input[n + si];
          tileIn[2 * tw * th + di] = input[2 * n + si];
        }
      }
      const res = await session.run({
        input: new ort.Tensor("float32", tileIn, [1, 3, th, tw]),
      });
      const t4 = res.output as ort.Tensor;
      const t4d = t4.data as Float32Array;
      const t4w = tw * 4, t4h = th * 4;
      // Downscale tile 4x -> skala akhir.
      let tileOut: { data: Uint8ClampedArray; w: number; h: number };
      if (scale === 2) {
        tileOut = blockAverage2x(t4d, t4w, t4h);
      } else {
        const img4 = new ImageData(new Uint8ClampedArray(t4w * t4h * 4), t4w, t4h);
        for (let i = 0; i < t4w * t4h; i++) {
          img4.data[i * 4] = Math.max(0, Math.min(255, Math.round(t4d[i] * 255)));
          img4.data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(t4d[t4w * t4h + i] * 255)));
          img4.data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(t4d[2 * t4w * t4h + i] * 255)));
          img4.data[i * 4 + 3] = 255;
        }
        const r3 = lanczosResample(img4, tw * 3, th * 3);
        tileOut = { data: r3.data, w: r3.width, h: r3.height };
      }
      // Tempel bagian tengah tile (crop zona seam), kecuali di tepi gambar.
      const cw = tileOut.w, ch = tileOut.h;
      const cropL = tx === 0 ? 0 : cropFinal;
      const cropT = ty === 0 ? 0 : cropFinal;
      const cropR = tx === tilesX - 1 ? 0 : cropFinal;
      const cropB = ty === tilesY - 1 ? 0 : cropFinal;
      const pasteX = x0 * scale + cropL;
      const pasteY = y0 * scale + cropT;
      const pasteW = cw - cropL - cropR;
      const pasteH = ch - cropT - cropB;
      for (let y = 0; y < pasteH; y++) {
        const sy = cropT + y, dy = pasteY + y;
        if (dy < 0 || dy >= outH) continue;
        for (let x = 0; x < pasteW; x++) {
          const sx = cropL + x, dx = pasteX + x;
          if (dx < 0 || dx >= outW) continue;
          const si = (sy * cw + sx) * 4, di = (dy * outW + dx) * 4;
          out[di] = tileOut.data[si];
          out[di + 1] = tileOut.data[si + 1];
          out[di + 2] = tileOut.data[si + 2];
          out[di + 3] = 255;
        }
      }
      done++;
      onTile(done, total);
    }
  }
  return { data: out, w: outW, h: outH };
}

/* ── Protokol pesan ── */
self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as {
    type: string;
    id: number;
    engine?: EngineId;
    buffer?: ArrayBuffer;
    kind?: string;
    w?: number;
    h?: number;
    data?: ArrayBuffer;
    mask?: ArrayBuffer;
    scale?: number;
  };
  try {
    if (msg.type === "load") {
      if (!msg.engine || !msg.buffer) throw new Error("load: engine/buffer kosong");
      await loadSession(msg.engine, msg.buffer);
      (self as unknown as { postMessage: (m: unknown) => void }).postMessage({ type: "result", id: msg.id, result: { engine: msg.engine, provider: providers.get(msg.engine) } });
      return;
    }
    if (msg.type === "run") {
      if (!msg.engine || !msg.data || !msg.w || !msg.h) throw new Error("run: payload kosong");
      const rgba = new Uint8ClampedArray(msg.data);
      const post = (m: unknown, transfer?: Transferable[]) => {
        (self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void }).postMessage(m, transfer || []);
      };
      if (msg.kind === "inpaint") {
        if (!msg.mask) throw new Error("inpaint: mask kosong");
        const r = await runInpaint(msg.w, msg.h, rgba, new Uint8Array(msg.mask));
        post({ type: "result", id: msg.id, result: { data: r.data.buffer, w: r.w, h: r.h } }, [r.data.buffer]);
      } else if (msg.kind === "bg") {
        const r = await runBg(msg.w, msg.h, rgba);
        post({ type: "result", id: msg.id, result: { data: r.data.buffer, w: r.w, h: r.h } }, [r.data.buffer]);
      } else if (msg.kind === "upscale") {
        const scale = msg.scale === 3 ? 3 : 2;
        const r = await runUpscale(msg.w, msg.h, rgba, scale as 2 | 3, (done, total) => {
          post({ type: "progress", id: msg.id, done, total, label: "Memperbesar " + done + "/" + total + " bagian" });
        });
        post({ type: "result", id: msg.id, result: { data: r.data.buffer, w: r.w, h: r.h } }, [r.data.buffer]);
      } else {
        throw new Error("kind tidak dikenal: " + msg.kind);
      }
      return;
    }
    throw new Error("pesan tidak dikenal: " + msg.type);
  } catch (e) {
    (self as unknown as { postMessage: (m: unknown) => void }).postMessage({ type: "error", id: msg.id, message: String((e as Error).message || e) });
  }
};
