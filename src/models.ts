/* Sirna — SATU engine per fitur (revisi 19 Nov 2026).
   Tiap fitur pakai SATU model, tanpa tier Instan/Cepat/Terbaik, tanpa
   pilihan presisi. Model diunduh LAZY saat alatnya dibuka (bukan saat
   halaman dimuat), di-cache sekali di Cache Storage, dan diverifikasi
   SHA-256 sebelum dipakai — URL resolve di-pin ke revisi commit HF,
   tidak pernah `main` tanpa pin.
   - Hapus Objek / Watermark: Mi-GAN migan_pipeline_v2.onnx, 28,1 MB, MIT
   - Hapus Latar: ORMBG int8 (model_quantized.onnx), ~44 MB, Apache-2.0
   - Perbesar: Real-ESRGAN General x4v3, 4,6 MB fp32, BSD-3-Clause
   Runtime: SATU onnxruntime-web (1.31.1) untuk ketiganya, inferensi di
   Web Worker (src/ai-worker.ts), WASM multi-thread SAJA — WebGPU
   sengaja tidak dipakai karena runtime WebGPU ORT (jsep wasm 29,5 MB)
   melebihi batas 25 MiB/file Cloudflare Static Assets (lihat
   vite.config.ts; upgrade path: host jsep di R2 + CORS).
   File ini TIDAK mengimpor onnxruntime-web — ORT hanya ada di worker,
   supaya main bundle tetap ringan. */

export type EngineId = "migan" | "ormbg" | "esrgan";

export interface ModelSpec {
  id: EngineId;
  file: string;
  url: string;
  sha256: string;
  size: number;
  license: string;
  label: string;
}

export const ORT_VERSION = "1.31.1";

export const MODELS: Record<EngineId, ModelSpec> = {
  migan: {
    id: "migan",
    file: "migan_pipeline_v2.onnx",
    // Revisi repo andraniksargsyan/migan di-pin (commit 406830d0…).
    url: "https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx",
    sha256: "6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b",
    size: 28079181,
    license: "MIT",
    label: "Mi-GAN",
  },
  ormbg: {
    id: "ormbg",
    file: "ormbg_int8.onnx",
    // Revisi repo onnx-community/ormbg-ONNX di-pin (commit 034e2d88…).
    // File q8/int8 SATU-SATUNYA yang dipakai (44.315.205 byte).
    url: "https://huggingface.co/onnx-community/ormbg-ONNX/resolve/034e2d884afbab897e10e78fc5bb566b29533fd6/onnx/model_quantized.onnx",
    sha256: "ffbcae62a7b675d616e64cb392ee028786c4cf74f83596590fba13733ef00171",
    size: 44315205,
    license: "Apache-2.0",
    label: "ORMBG",
  },
  esrgan: {
    id: "esrgan",
    file: "realesr-general-x4v3.onnx",
    // Revisi export CoderViking di-pin (commit c6a97170…).
    url: "https://huggingface.co/CoderViking/realesr-general-x4v3-onnx/resolve/c6a971706797c7502945a2b4c4274fce4900d4ab/realesr-general-x4v3.onnx",
    sha256: "1940a93ee08283a0a7286183186357b1688fe9fa8ede74604b424586aaddf112",
    size: 4866417,
    license: "BSD-3-Clause",
    label: "Real-ESRGAN x4v3",
  },
};

const CACHE_NAME = "sirna-models-v2";

export function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(".", ",") + " MB";
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface DownloadProgress {
  loaded: number;
  total: number; // 0 kalau server tidak mengirim Content-Length
  fromCache: boolean;
}

/* Unduh (atau ambil dari cache) SATU model, verifikasi SHA-256, kembalikan
   ArrayBuffer-nya. onProgress dipanggil selama download jaringan saja.
   signal = AbortController pengguna (tombol Batalkan). */
export async function getModelBytes(
  engine: EngineId,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const spec = MODELS[engine];
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(spec.url);
  if (cached) {
    const buf = await cached.arrayBuffer();
    if ((await sha256Hex(buf)) === spec.sha256) {
      onProgress?.({ loaded: spec.size, total: spec.size, fromCache: true });
      return buf;
    }
    // Cache rusak / beda isi — buang, unduh ulang.
    await cache.delete(spec.url);
  }
  const res = await fetch(spec.url, { signal, mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error("Gagal unduh model (" + res.status + ")");
  const total = Number(res.headers.get("content-length") || spec.size) || 0;
  if (!res.body) {
    const buf = await res.arrayBuffer();
    if ((await sha256Hex(buf)) !== spec.sha256) throw new Error("Model tidak cocok (SHA-256)");
    await cache.put(spec.url, new Response(buf.slice(0), { headers: { "content-type": "application/octet-stream" } }));
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total, fromCache: false });
    }
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  const ab = buf.buffer;
  if ((await sha256Hex(ab)) !== spec.sha256) throw new Error("Model tidak cocok (SHA-256)");
  await cache.put(spec.url, new Response(ab.slice(0), { headers: { "content-type": "application/octet-stream" } }));
  return ab;
}

/* Apakah model sudah tersimpan di HP (tanpa mengunduh)? */
export async function isModelCached(engine: EngineId): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(MODELS[engine].url);
    if (!hit) return false;
    return (await sha256Hex(await hit.arrayBuffer())) === MODELS[engine].sha256;
  } catch (_e) {
    return false;
  }
}

/* Hapus model tersimpan (dipakai kalau cache rusak / pengguna mau hemat ruang). */
export async function deleteModelCache(engine: EngineId): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(MODELS[engine].url);
}

/* ── Klien Web Worker (src/ai-worker.ts) ──
   Satu worker dipakai ulang semua engine; session dibuat sekali per
   engine di dalam worker. Pesan: load (transfer ArrayBuffer model),
   run (payload per engine), progress per tile (upscale), cancel
   (terminate worker — session ikut hilang, load berikutnya dari cache). */

export type AiJob =
  | { kind: "inpaint"; image: ImageData; mask: Uint8Array } // mask: 1 = lubang
  | { kind: "bg"; image: ImageData } // ImageData 1024x1024 RGBA
  | { kind: "upscale"; image: ImageData; scale: 2 | 3 }; // 4x penuh, tiling di worker

export interface AiProgress {
  done: number;
  total: number;
  label: string;
}

let worker: Worker | null = null;
let jobSeq = 0;
const pending = new Map<number, {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (p: AiProgress) => void;
}>();
const loadedEngines = new Set<EngineId>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./ai-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as
      | { type: "result"; id: number; result: unknown }
      | { type: "progress"; id: number; done: number; total: number; label: string }
      | { type: "error"; id: number; message: string };
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === "result") { pending.delete(msg.id); p.resolve(msg.result); }
    else if (msg.type === "progress") { p.onProgress?.({ done: msg.done, total: msg.total, label: msg.label }); }
    else { pending.delete(msg.id); p.reject(new Error(msg.message || "AI gagal")); }
  };
  worker.onerror = (ev) => {
    const err = new Error("Worker AI error: " + (ev.message || "tidak diketahui"));
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };
  return worker;
}

/* Batalkan semua job yang jalan: worker di-terminate (session ikut
   hilang — load berikutnya membuat session baru dari model yang sudah
   di-cache, jadi tidak unduh ulang). */
export function cancelAiJobs(): void {
  if (worker) { worker.terminate(); worker = null; }
  loadedEngines.clear();
  const err = new Error("Dibatalkan");
  for (const [, p] of pending) p.reject(err);
  pending.clear();
}

function callWorker<T>(msg: Record<string, unknown>, transfer: Transferable[], onProgress?: (p: AiProgress) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++jobSeq;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    getWorker().postMessage({ ...msg, id }, transfer);
  });
}

/* Pastikan session engine siap di worker (unduh dulu kalau belum ada).
   onDownload = progres unduh model; onProgress = progres inferensi. */
export async function ensureEngine(
  engine: EngineId,
  opts: {
    onDownload?: (p: DownloadProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  if (loadedEngines.has(engine) && worker) return;
  const bytes = await getModelBytes(engine, opts.onDownload, opts.signal);
  // Session dibuat di worker; buffer di-transfer (bukan disalin).
  await callWorker({ type: "load", engine, buffer: bytes }, [bytes]);
  loadedEngines.add(engine);
}

export async function runAi<T>(engine: EngineId, job: AiJob, onProgress?: (p: AiProgress) => void): Promise<T> {
  if (!loadedEngines.has(engine)) throw new Error("Engine " + engine + " belum dimuat");
  const transfer: Transferable[] = [];
  // ImageData tidak transferable — kirim SALINAN data mentahnya supaya
  // ImageData pemanggil tetap utuh (masih dipakai untuk composite-back).
  const dataBuf = job.image.data.slice().buffer as ArrayBuffer;
  const payload: Record<string, unknown> = { kind: job.kind, w: job.image.width, h: job.image.height, data: dataBuf };
  transfer.push(dataBuf);
  if (job.kind === "inpaint") {
    const maskBuf = job.mask.slice().buffer as ArrayBuffer;
    payload.mask = maskBuf;
    transfer.push(maskBuf);
  }
  if (job.kind === "upscale") {
    payload.scale = (job as { scale?: number }).scale || 2;
  }
  return callWorker<T>({ type: "run", engine, ...payload }, transfer, onProgress);
}
