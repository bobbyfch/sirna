/* Hapus Objek / Magic Eraser — editor + mesin inpainting.
   Tiga mode, semuanya 100% lokal di browser; nggak ada yang diunduh
   sebelum user buka tool ini:
   - Instan: Telea fast-marching (src/telea.ts), tanpa download.
   - Cepat AI: MI-GAN ONNX (~27 MB) via onnxruntime-web, lazy-load.
   - Terbaik: LaMa ONNX (~198 MB) via onnxruntime-web, lazy-load.
   Model diunduh SEKALI (kelihatan ukurannya dulu + progress bar), lalu
   disimpan di Cache Storage — buka kedua langsung siap, offline pun jalan.
   onnxruntime-web sendiri dimuat malas (dynamic import) pas mode AI
   pertama dipakai; chunk-nya nggak ada di JS awal. */

import { inpaintTelea, dilateMask } from "./telea";

type OrtModule = typeof import("onnxruntime-web/wasm");

/* ── Model: URL diverifikasi hidup (HEAD 2026-11-18) ──
   MI-GAN: huggingface.co/andraniksargsyan/migan — migam_pipeline_v2.onnx,
   28.079.181 byte. Input image uint8 [1,3,H,W] + mask uint8 [1,1,H,W]
   (255 = dikenal, 0 = lubang); output result uint8 [1,3,H,W].
   LaMa: huggingface.co/Carve/LaMa-ONNX — lama_fp32.onnx, 208.044.816 byte.
   Input image float32 0-1 [1,3,512,512] + mask float32 1=lubang;
   output float32 0-255 [1,3,512,512] (sudah skala 0-255, JANGAN dikali lagi). */
const MODEL_CACHE = "sirna-models-v1";
const MODELS = {
  migan: {
    key: "migan" as const,
    label: "Cepat AI",
    model: "MI-GAN",
    size: 28079181,
    url: "https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx",
  },
  lama: {
    key: "lama" as const,
    label: "Terbaik",
    model: "LaMa",
    size: 208044816,
    url: "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx",
  },
} as const;
type ModelKey = keyof typeof MODELS;

const MAX_WORK = 2048; // sisi panjang maks. kanvas kerja editor (semua mode)
const MAX_AI = 1024; // sisi panjang maks. input model AI (LaMa tetap 512²)

function fmtMB(b: number): string {
  return (b / 1048576).toFixed(b >= 104857600 ? 0 : 1) + " MB";
}

/* ── Cache model ── */
async function modelCached(key: ModelKey): Promise<boolean> {
  try {
    const c = await caches.open(MODEL_CACHE);
    const hit = await c.match(MODELS[key].url);
    if (!hit) return false;
    const buf = await hit.arrayBuffer();
    return buf.byteLength === MODELS[key].size;
  } catch (_e) { return false; }
}

async function downloadModel(key: ModelKey, onProgress: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  const m = MODELS[key];
  const cache = await caches.open(MODEL_CACHE);
  const hit = await cache.match(m.url);
  if (hit) {
    const buf = await hit.arrayBuffer();
    if (buf.byteLength === m.size) { onProgress(m.size, m.size); return buf; }
    await cache.delete(m.url); // korup / beda versi: unduh ulang
  }
  const res = await fetch(m.url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error("Model gagal diunduh (HTTP " + res.status + "). Coba lagi pakai Wi-Fi.");
  const total = Number(res.headers.get("content-length") || m.size) || m.size;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  chunks.length = 0; // lepas 198 MB potongan SEBELUM cache.put + sesi (hemat RAM)
  if (buf.byteLength !== m.size) throw new Error("Model tidak lengkap (" + fmtMB(buf.byteLength) + " dari " + fmtMB(m.size) + "). Coba lagi.");
  await cache.put(m.url, new Response(buf as unknown as BodyInit, { headers: { "content-type": "application/octet-stream" } }));
  return buf.buffer as ArrayBuffer;
}

async function deleteModel(key: ModelKey): Promise<void> {
  try {
    const c = await caches.open(MODEL_CACHE);
    await c.delete(MODELS[key].url);
  } catch (_e) { /* abaikan */ }
}

/* ── onnxruntime-web (lazy) + sesi model ── */
let ortMod: OrtModule | null = null;
const sessions = new Map<ModelKey, unknown>();

async function loadOrt(): Promise<OrtModule> {
  if (ortMod) return ortMod;
  const ort = await import("onnxruntime-web/wasm");
  /* Runtime wasm disalin build ke assets/ort/ (lihat vite.config.ts).
     COOP + COEP credentialless di _headers bikin crossOriginIsolated
     true di Chrome/Firefox → wasm bisa pakai sampai 4 thread; kalau
     tidak terisolasi (mis. Safari) ya tetap jalan 1 thread. */
  const base = new URL("assets/ort/", document.baseURI).href;
  ort.env.wasm.wasmPaths = {
    wasm: base + "ort-wasm-simd-threaded.wasm",
    mjs: base + "ort-wasm-simd-threaded.mjs",
  } as unknown as string;
  ort.env.wasm.proxy = false; // inferensi di thread utama (nggak butuh worker proxy)
  ort.env.wasm.numThreads = (typeof crossOriginIsolated !== "undefined" && crossOriginIsolated)
    ? Math.min(4, Math.max(1, navigator.hardwareConcurrency || 2))
    : 1;
  ortMod = ort;
  return ort;
}

async function getSession(key: ModelKey, onProgress: (loaded: number, total: number) => void): Promise<unknown> {
  const hit = sessions.get(key);
  if (hit) return hit;
  const ort = await loadOrt();
  /* Unduh + simpan ke cache dulu, lalu baca byte dari cache buat sesi.
     Buffer unduhan dilepas sebelum sesi dibuat — kalau buffer unduhan
     dipertahankan sampai create(), RAM kepegang 2x ukuran model
     (penting buat LaMa 198 MB di HP). */
  await downloadModel(key, onProgress);
  const cache = await caches.open(MODEL_CACHE);
  const res = await cache.match(MODELS[key].url);
  if (!res) throw new Error("Model gagal dibaca dari cache.");
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== MODELS[key].size) throw new Error("Model di cache tidak lengkap.");
  const session = await (ort as unknown as { InferenceSession: { create: (b: ArrayBuffer, o: object) => Promise<unknown> } }).InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  sessions.set(key, session);
  return session;
}

/* ── Util gambar ── */
function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function drawTo(img: CanvasImageSource, w: number, h: number): ImageData {
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
function imageDataToCanvas(d: ImageData): HTMLCanvasElement {
  const c = canvasOf(d.width, d.height);
  (c.getContext("2d") as CanvasRenderingContext2D).putImageData(d, 0, 0);
  return c;
}
/* HWC interleaved (ImageData) -> CHW planar */
function hwcToChw(data: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): Uint8Array<ArrayBuffer> {
  const n = w * h, out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[c * n + i] = data[i * 4 + c];
  return out;
}
function chwToHwc(chw: ArrayLike<number>, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const n = w * h, out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[i * 4 + c] = chw[c * n + i] as number;
  for (let i = 0; i < n; i++) out[i * 4 + 3] = 255;
  return out;
}

/* ── Runner AI ──
   Semua runner terima ImageData + mask (1 = lubang) di resolusi kerja dan
   mengembalikan ImageData hasil di resolusi yang sama. Piksel di luar
   mask dijaga sama persis oleh pemanggil (composite-back), jadi runner
   boleh mengembalikan gambar utuh hasil model. */
async function runMigan(img: ImageData, mask: Uint8Array<ArrayBuffer>, onProgress: (l: number, t: number) => void): Promise<ImageData> {
  const { width: w, height: h } = img;
  const session = await getSession("migan", onProgress) as {
    run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Uint8Array }>>;
  };
  const ort = await loadOrt();
  const n = w * h;
  const maskU8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) maskU8[i] = mask[i] ? 0 : 255; // pipeline: 0 = lubang
  const out = await session.run({
    image: new (ort as unknown as { Tensor: new (t: string, d: unknown, s: number[]) => unknown }).Tensor("uint8", hwcToChw(img.data, w, h), [1, 3, h, w]),
    mask: new (ort as unknown as { Tensor: new (t: string, d: unknown, s: number[]) => unknown }).Tensor("uint8", maskU8, [1, 1, h, w]),
  });
  const res = out["result"].data as Uint8Array;
  return new ImageData(chwToHwc(res, w, h), w, h);
}

async function runLama(img: ImageData, mask: Uint8Array<ArrayBuffer>, onProgress: (l: number, t: number) => void): Promise<ImageData> {
  const { width: w, height: h } = img;
  const session = await getSession("lama", onProgress) as {
    run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>;
  };
  const ort = await loadOrt();
  // LaMa cuma terima 512×512 (diregang): gambar + mask disamakan dulu.
  const smallImg = drawTo(imageDataToCanvas(img), 512, 512);
  const maskCanvas = canvasOf(w, h);
  const mctx = maskCanvas.getContext("2d") as CanvasRenderingContext2D;
  const mImg = mctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = mask[i] ? 255 : 0; mImg.data[i * 4] = v; mImg.data[i * 4 + 1] = v; mImg.data[i * 4 + 2] = v; mImg.data[i * 4 + 3] = 255; }
  mctx.putImageData(mImg, 0, 0);
  const smallMask = drawTo(maskCanvas, 512, 512);
  const N = 512 * 512;
  const imgF = new Float32Array(N * 3);
  const maskF = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 3; c++) imgF[c * N + i] = smallImg.data[i * 4 + c] / 255;
    maskF[i] = smallMask.data[i * 4] > 0 ? 1 : 0;
  }
  const out = await session.run({
    image: new (ort as unknown as { Tensor: new (t: string, d: unknown, s: number[]) => unknown }).Tensor("float32", imgF, [1, 3, 512, 512]),
    mask: new (ort as unknown as { Tensor: new (t: string, d: unknown, s: number[]) => unknown }).Tensor("float32", maskF, [1, 1, 512, 512]),
  });
  const res = out["output"].data as Float32Array; // sudah skala 0-255
  const big = new ImageData(chwToHwcFloat(res, 512, 512), 512, 512);
  // Balik ke resolusi kerja.
  return drawTo(imageDataToCanvas(big), w, h);
}
function chwToHwcFloat(chw: Float32Array, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const n = w * h, out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = chw[c * n + i];
      out[i * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

/* Downscale ImageData ke sisi panjang <= max (nggak pernah upscale). */
function downscale(img: ImageData, max: number): { img: ImageData; scale: number } {
  const m = Math.max(img.width, img.height);
  if (m <= max) return { img, scale: 1 };
  const s = max / m;
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  return { img: drawTo(imageDataToCanvas(img), w, h), scale: s };
}
function downscaleMask(mask: Uint8Array<ArrayBuffer>, w: number, h: number, nw: number, nh: number): Uint8Array<ArrayBuffer> {
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  const d = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = mask[i] ? 255 : 0; d.data[i * 4] = v; d.data[i * 4 + 1] = v; d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; }
  ctx.putImageData(d, 0, 0);
  const small = drawTo(c, nw, nh);
  const out = new Uint8Array(nw * nh);
  for (let i = 0; i < nw * nh; i++) out[i] = small.data[i * 4] > 127 ? 1 : 0;
  return out;
}

/* ═══════════ Editor ═══════════ */
export interface EraseSource {
  name: string; // nama file asal
  blob: Blob; // gambar yang diedit (hasil bersih kalau ada, kalau tidak file asli)
  type: string; // mime hasil bersih / asli
  suggestName: string; // nama file buat Simpan/Unduh (ikut setelan -clean / Sama)
}
export interface EraseHooks {
  onReplace: (blob: Blob) => void; // jadikan hasil ini file bersih yang baru
  onToast: (msg: string) => void;
}

const MODE_DESC: Record<string, string> = {
  instant: "Tanpa download — buat coretan kecil, teks & watermark.",
  migan: "Model MI-GAN · 27 MB, sekali unduh lalu tersimpan di HP. Buat orang & benda.",
  lama: "Model LaMa · 198 MB, sekali unduh lalu tersimpan di HP. Hasil paling rapi, lubang besar.",
};

export interface EraseOptions {
  title?: string; // judul modal — default "Hapus Objek"
  /* Mask awal (mis. hasil deteksi watermark): dipanggil sekali pas gambar
     kerja sudah dimuat; kalau mengembalikan mask, mask itu langsung
     ditandain merah dan `painted` jadi true — user tinggal tekan Hapus
     atau ngubah dulu pakai kuas. null = tidak ketemu, mode manual. */
  initialMask?: (img: ImageData) => { mask: Uint8Array<ArrayBuffer>; note: string } | null;
  noMaskNote?: string; // catatan kalau initialMask mengembalikan null
}

function $(id: string): HTMLElement { return document.getElementById(id) as HTMLElement; }

export async function openEraser(source: EraseSource, hooks: EraseHooks, opts: EraseOptions = {}): Promise<void> {
  const modal = $("eraseModal");
  const display = $("eraseCanvas") as HTMLCanvasElement;
  const overlay = $("eraseOverlay") as HTMLCanvasElement;
  const dctx = display.getContext("2d") as CanvasRenderingContext2D;
  const octx = overlay.getContext("2d") as CanvasRenderingContext2D;

  // Muat gambar ke kanvas kerja (sisi panjang maks 2048).
  const bmp = await createImageBitmap(source.blob);
  const ow = bmp.width, oh = bmp.height;
  const ws = Math.min(1, MAX_WORK / Math.max(ow, oh));
  const ww = Math.max(1, Math.round(ow * ws)), wh = Math.max(1, Math.round(oh * ws));
  display.width = ww; display.height = wh;
  overlay.width = ww; overlay.height = wh;
  dctx.drawImage(bmp, 0, 0, ww, wh);
  bmp.close();
  const sessionOriginal = dctx.getImageData(0, 0, ww, wh);
  let current = new ImageData(new Uint8ClampedArray(sessionOriginal.data), ww, wh);

  // Mask di resolusi kerja.
  const maskCanvas = canvasOf(ww, wh);
  const mctx = maskCanvas.getContext("2d") as CanvasRenderingContext2D;
  mctx.lineCap = "round"; mctx.lineJoin = "round";
  mctx.strokeStyle = "#fff"; mctx.fillStyle = "#fff";
  let mask = new Uint8Array(ww * wh);
  let painted = false;
  const undoStack: Uint8Array<ArrayBuffer>[] = [];
  const MAX_UNDO = 20;

  let mode: "instant" | "migan" | "lama" = "instant";
  let brush = 48;
  let busy = false;
  let exportBlob: Blob | null = null;
  let exportType = source.type === "image/jpeg" ? "image/jpeg" : source.type === "image/webp" ? "image/webp" : "image/png";

  function readMask(): Uint8Array<ArrayBuffer> {
    const d = mctx.getImageData(0, 0, ww, wh).data;
    const out = new Uint8Array(ww * wh);
    for (let i = 0; i < ww * wh; i++) out[i] = d[i * 4 + 3] > 0 ? 1 : 0;
    return out;
  }
  function renderOverlay(): void {
    octx.clearRect(0, 0, ww, wh);
    octx.drawImage(maskCanvas, 0, 0);
    octx.globalCompositeOperation = "source-in";
    octx.fillStyle = "rgba(255,59,48,0.45)";
    octx.fillRect(0, 0, ww, wh);
    octx.globalCompositeOperation = "source-over";
  }
  /* Tulis mask (1 = hapus) ke maskCanvas + state — dipakai Urungkan dan
     mask awal (mis. hasil deteksi watermark). */
  function applyMask(m: Uint8Array<ArrayBuffer>): void {
    mask = m.slice();
    mctx.clearRect(0, 0, ww, wh);
    const d = mctx.createImageData(ww, wh);
    for (let i = 0; i < ww * wh; i++) { const v = mask[i] ? 255 : 0; d.data[i * 4] = v; d.data[i * 4 + 1] = v; d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = v; }
    mctx.putImageData(d, 0, 0);
    renderOverlay();
  }
  function renderDisplay(): void {
    dctx.putImageData(current, 0, 0);
  }
  function setNote(t: string): void { $("eraseNote").textContent = t; }
  function setRunLabel(t: string, disabled: boolean): void {
    const b = $("eraseRun") as HTMLButtonElement;
    b.textContent = t; b.disabled = disabled;
  }

  /* ── Model bar ── */
  async function refreshModelBar(): Promise<void> {
    const bar = $("eraseModelBar");
    if (mode === "instant") { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    const m = MODELS[mode];
    $("eraseModelLabel").textContent = "Model " + m.model + " · " + fmtMB(m.size);
    const cached = await modelCached(mode);
    const st = $("eraseModelState");
    const dl = $("eraseModelBtn") as HTMLButtonElement;
    const del = $("eraseModelDel");
    if (cached) {
      st.textContent = "Tersimpan di HP ✓";
      dl.classList.add("hidden"); del.classList.remove("hidden");
      ($("eraseModelFill") as HTMLElement).style.width = "100%";
    } else {
      st.textContent = "Belum diunduh";
      dl.classList.remove("hidden"); del.classList.add("hidden");
      ($("eraseModelFill") as HTMLElement).style.width = "0%";
    }
  }
  function setModelProgress(loaded: number, total: number, phase: string): void {
    const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    ($("eraseModelFill") as HTMLElement).style.width = pct + "%";
    $("eraseModelState").textContent = phase + " " + fmtMB(loaded) + " / " + fmtMB(total) + " · " + pct + "%";
  }
  function setMode(next: "instant" | "migan" | "lama"): void {
    mode = next;
    document.querySelectorAll("[data-erase-mode]").forEach((b) => b.setAttribute("aria-pressed", (b as HTMLElement).dataset.eraseMode === next ? "true" : "false"));
    $("eraseModeDesc").textContent = MODE_DESC[next];
    refreshModelBar();
  }

  /* ── Melukis mask ── */
  let painting = false, lastX = 0, lastY = 0, rafPending = false;
  function evtPos(e: PointerEvent): [number, number] {
    const r = display.getBoundingClientRect();
    return [(e.clientX - r.left) * (ww / r.width), (e.clientY - r.top) * (wh / r.height)];
  }
  function strokeTo(x: number, y: number): void {
    mctx.lineWidth = brush;
    mctx.beginPath();
    mctx.moveTo(lastX, lastY);
    mctx.lineTo(x, y);
    mctx.stroke();
    // Titik awal (ketukan tanpa geser) tetap ninggalin jejak.
    mctx.beginPath(); mctx.arc(x, y, brush / 2, 0, Math.PI * 2); mctx.fill();
    lastX = x; lastY = y;
    painted = true;
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; mask = readMask(); renderOverlay(); });
    }
  }
  display.addEventListener("pointerdown", (e) => {
    if (busy) return;
    e.preventDefault();
    display.setPointerCapture(e.pointerId);
    undoStack.push(mask.slice());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    painting = true;
    [lastX, lastY] = evtPos(e);
    strokeTo(lastX, lastY);
    $("eraseResultBar").classList.add("hidden");
  });
  display.addEventListener("pointermove", (e) => {
    if (!painting || busy) return;
    e.preventDefault();
    const [x, y] = evtPos(e);
    strokeTo(x, y);
  });
  function endStroke(): void { painting = false; mask = readMask(); renderOverlay(); }
  display.addEventListener("pointerup", endStroke);
  display.addEventListener("pointercancel", endStroke);

  /* ── Toolbar ── */
  document.querySelectorAll("[data-erase-mode]").forEach((b) =>
    b.addEventListener("click", () => { if (!busy) setMode((b as HTMLElement).dataset.eraseMode as "instant" | "migan" | "lama"); }));
  const brushInput = $("eraseBrush") as HTMLInputElement;
  brushInput.addEventListener("input", () => {
    brush = parseInt(brushInput.value, 10) || 48;
    $("eraseBrushVal").textContent = brush + " px";
  });
  $("eraseUndo").addEventListener("click", () => {
    const prev = undoStack.pop();
    if (!prev) { hooks.onToast("Nggak ada yang bisa diurungkan."); return; }
    applyMask(prev);
  });
  $("eraseClear").addEventListener("click", () => {
    undoStack.push(mask.slice());
    mask = new Uint8Array(ww * wh);
    mctx.clearRect(0, 0, ww, wh);
    renderOverlay();
    setNote("");
  });
  // Bandingkan: tahan buat lihat asli (sebelum hapus di sesi ini).
  const cmp = $("eraseCompare");
  function cmpShow(e: Event): void { e.preventDefault(); dctx.putImageData(sessionOriginal, 0, 0); octx.clearRect(0, 0, ww, wh); }
  function cmpHide(): void { renderDisplay(); renderOverlay(); }
  cmp.addEventListener("pointerdown", cmpShow);
  cmp.addEventListener("pointerup", cmpHide);
  cmp.addEventListener("pointerleave", cmpHide);
  cmp.addEventListener("pointercancel", cmpHide);

  /* ── Model: unduh / hapus manual ── */
  ($("eraseModelBtn") as HTMLButtonElement).addEventListener("click", async () => {
    if (busy || mode === "instant") return;
    busy = true;
    setModelProgress(0, MODELS[mode].size, "Mengunduh…");
    try {
      await downloadModel(mode, (l, t) => setModelProgress(l, t, "Mengunduh…"));
      await refreshModelBar();
      hooks.onToast("Model " + MODELS[mode].model + " tersimpan ✓");
    } catch (e) {
      setModelProgress(0, MODELS[mode].size, "Gagal.");
      hooks.onToast("Gagal unduh model: " + (e as Error).message);
    }
    busy = false;
  });
  $("eraseModelDel").addEventListener("click", async () => {
    if (busy || mode === "instant") return;
    await deleteModel(mode);
    sessions.delete(mode);
    await refreshModelBar();
    hooks.onToast("Model " + MODELS[mode].model + " dihapus dari HP.");
  });

  /* ── Composite-back: hasil kerja ditempel ke ukuran penuh, luar mask
     tetap byte-identical dengan file asli. ── */
  async function buildExport(result: ImageData): Promise<Blob> {
    const full = await createImageBitmap(source.blob);
    const fw = full.width, fh = full.height;
    const outC = canvasOf(fw, fh);
    const octx2 = outC.getContext("2d") as CanvasRenderingContext2D;
    octx2.drawImage(full, 0, 0);
    full.close();
    // Hasil kerja (resolusi kerja) -> ukuran penuh, cuma di area mask.
    const resC = imageDataToCanvas(result);
    const tmp = canvasOf(fw, fh);
    const tctx = tmp.getContext("2d") as CanvasRenderingContext2D;
    tctx.drawImage(resC, 0, 0, fw, fh);
    const mFull = canvasOf(fw, fh);
    const mfctx = mFull.getContext("2d") as CanvasRenderingContext2D;
    mfctx.drawImage(maskCanvas, 0, 0, fw, fh); // smoothing aktif: tepi mask jadi lembut
    tctx.globalCompositeOperation = "destination-in";
    tctx.drawImage(mFull, 0, 0);
    tctx.globalCompositeOperation = "source-over";
    octx2.drawImage(tmp, 0, 0);
    const blob = await new Promise<Blob | null>((res) => outC.toBlob(res, exportType, 0.92));
    if (!blob) throw new Error("Gagal encode hasil.");
    return blob;
  }

  /* ── Hapus! ── */
  $("eraseRun").addEventListener("click", async () => {
    if (busy) return;
    if (!painted || !mask.some((v) => v)) { hooks.onToast("Coret dulu area yang mau dihapus."); return; }
    busy = true;
    setRunLabel("Lagi mikir…", true);
    ($("eraseResultBar") as HTMLElement).classList.add("hidden");
    setNote("");
    try {
      const m = dilateMask(mask, ww, wh, 1);
      let result: ImageData;
      if (mode === "instant") {
        result = new ImageData(inpaintTelea(current.data, m, ww, wh), ww, wh);
      } else if (mode === "migan") {
        const { img, scale } = downscale(current, MAX_AI);
        const sm = scale === 1 ? m : downscaleMask(m, ww, wh, img.width, img.height);
        const ai = await runMigan(img, sm, (l, t) => setModelProgress(l, t, "Mengunduh model…"));
        result = scale === 1 ? ai : drawTo(imageDataToCanvas(ai), ww, wh);
      } else {
        const { img, scale } = downscale(current, MAX_AI);
        const sm = scale === 1 ? m : downscaleMask(m, ww, wh, img.width, img.height);
        const ai = await runLama(img, sm, (l, t) => setModelProgress(l, t, "Mengunduh model…"));
        result = scale === 1 ? ai : drawTo(imageDataToCanvas(ai), ww, wh);
      }
      // Tempel hasil ke gambar kerja: luar mask = piksel kerja yang lama.
      const merged = new ImageData(new Uint8ClampedArray(current.data), ww, wh);
      for (let i = 0; i < ww * wh; i++) {
        if (m[i]) {
          for (let c = 0; c < 4; c++) merged.data[i * 4 + c] = result.data[i * 4 + c];
        }
      }
      current = merged;
      renderDisplay();
      // Mask habis dipakai: bersihin buat coretan berikutnya.
      mask = new Uint8Array(ww * wh);
      mctx.clearRect(0, 0, ww, wh);
      renderOverlay();
      undoStack.length = 0;
      exportBlob = await buildExport(current);
      const downscaled = ws < 1;
      setNote(
        "Beres ✓ Diproses di " + ww + "×" + wh +
        (downscaled ? " (asli " + ow + "×" + oh + " — hasil ditempel balik" : "") +
        " · luar coretan nggak berubah."
      );
      ($("eraseResultBar") as HTMLElement).classList.remove("hidden");
      await refreshModelBar();
    } catch (e) {
      hooks.onToast("Gagal hapus: " + (e as Error).message);
    }
    busy = false;
    setRunLabel("Hapus", false);
  });

  $("eraseSave").addEventListener("click", () => {
    if (!exportBlob) return;
    hooks.onReplace(exportBlob);
    close();
  });
  $("eraseDownload").addEventListener("click", () => {
    if (!exportBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(exportBlob);
    a.download = source.suggestName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 2000);
    hooks.onToast("Mengunduh " + source.suggestName);
  });
  $("eraseMore").addEventListener("click", () => {
    ($("eraseResultBar") as HTMLElement).classList.add("hidden");
    setNote("Coret lagi kalau masih ada yang mau dihapus.");
  });

  function close(): void {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }
  $("eraseClose").addEventListener("click", () => { if (!busy) close(); });
  modal.addEventListener("click", (e) => { if (e.target === modal && !busy) close(); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape" && !modal.classList.contains("hidden") && !busy) { close(); document.removeEventListener("keydown", esc); }
  });

  /* ── Buka ── */
  /* Judul selalu diatur (bukan cuma kalau opts.title ada) — kalau tidak,
     judul "Hapus Watermark" dari sesi sebelumnya nempel pas buka
     Hapus Objek sesudahnya. */
  $("eraseTitle").textContent = opts.title || "Hapus Objek";
  modal.setAttribute("aria-label", opts.title || "Hapus Objek");
  $("eraseSub").textContent = source.name + " · " + ow + "×" + oh + (ws < 1 ? " · diedit di " + ww + "×" + wh : "");
  setMode("instant");
  setNote("");
  ($("eraseResultBar") as HTMLElement).classList.add("hidden");
  /* Mask awal (mis. deteksi watermark): ditandain merah sebelum editor
     tampil; Urungkan bisa ngebatalin tandaan ini (mask kosong di-push
     dulu). Deteksi gagal = mode manual, bukan error. */
  if (opts.initialMask) {
    try {
      const found = opts.initialMask(current);
      if (found && found.mask.some((v) => v)) {
        undoStack.push(new Uint8Array(ww * wh));
        applyMask(found.mask);
        painted = true;
        setNote(found.note);
      } else if (opts.noMaskNote) {
        setNote(opts.noMaskNote);
      }
    } catch (_e) { /* abaikan — user coret manual */ }
  }
  renderDisplay();
  renderOverlay();
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
