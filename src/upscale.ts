/* Perbesar — SATU engine: Real-ESRGAN General x4v3 (4,6 MB fp32,
   BSD-3-Clause). Diunduh sekali saat alat dibuka, tersimpan di Cache
   Storage, inferensi di Web Worker (src/models.ts + src/ai-worker.ts).
   Model native 4x: 2x = 4x lalu rata-rata blok 2x2, 3x = 4x lalu
   Lanczos ke 3x — tiling di worker (256px, overlap 32px), progres
   per tile + batalkan. Output model TIDAK di-clamp — clamp ke [0,1]
   saat encode (lihat ai-worker.ts). fp32 dulu; JANGAN pindah ke fp16
   tanpa validasi per-browser (riwayat output hitam di Chrome).
   Foto kerja dibatasi 2048 px sisi panjang (3x: 1365 px) biar tab HP
   tidak kehabisan memori — output maks ~16 MP.
   Lanczos (src/lanczos.ts) cuma fallback offline diam-diam, dengan
   teks status yang jujur: interpolasi tidak menciptakan detail.
   WASM-only (tanpa WebGPU — lihat vite.config.ts): input dibatasi
   1024 px sisi panjang (3x: 768 px) supaya waktu tiling tetap masuk
   akal di HP — output maks ~9 MP. */

import type { EraseSource, EraseHooks } from "./erase";
import { lanczosUpscale, type Upscale } from "./lanczos";
import { ensureEngine, runAi, cancelAiJobs, type DownloadProgress, type AiProgress } from "./models";

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
async function blobToImageData(blob: Blob, maxSide: number): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return ctx.getImageData(0, 0, w, h);
}
function downscaleTo(img: ImageData, maxSide: number): ImageData {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (s === 1) return img;
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const src = canvasOf(img.width, img.height);
  (src.getContext("2d") as CanvasRenderingContext2D).putImageData(img, 0, 0);
  const c = canvasOf(w, h);
  (c.getContext("2d") as CanvasRenderingContext2D).drawImage(src, 0, 0, w, h);
  return (c.getContext("2d") as CanvasRenderingContext2D).getImageData(0, 0, w, h);
}
function imageDataToBlob(d: ImageData, type: string): Promise<Blob> {
  const c = canvasOf(d.width, d.height);
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  if (type === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, d.width, d.height);
  }
  ctx.putImageData(d, 0, 0);
  return new Promise<Blob>((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("Gagal encode gambar."))), type, 0.92));
}

function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

export interface UpscaleOptions {
  showUseOriginal?: boolean;
}

const WORK_MAX_2X = 1024; // sisi panjang maks foto kerja (2x) — WASM-only
const WORK_MAX_3X = 768; // 3x: lebih kecil dulu biar waktu tiling masuk akal

export async function openUpscale(source: EraseSource, hooks: EraseHooks, opts: UpscaleOptions = {}): Promise<void> {
  const modal = $("upModal");
  const preview = $("upPreview") as HTMLImageElement;

  const work = await blobToImageData(source.blob, WORK_MAX_2X);
  const outType = source.type === "image/jpeg" ? "image/jpeg"
    : source.type === "image/webp" ? "image/webp" : "image/png";

  let scale: Upscale = 2;
  let busy = false;
  let exportBlob: Blob | null = null;
  let previewUrl: string | null = null;
  let origUrl: string | null = null;
  let resultUrl: string | null = null;
  let abort: AbortController | null = null;

  function setPreviewImg(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    preview.src = url;
    return url;
  }
  function setNote(t: string): void {
    $("upNote").textContent = t;
  }
  function showOriginal(): void {
    if (origUrl) preview.src = origUrl;
  }
  function showResult(): void {
    if (resultUrl) preview.src = resultUrl;
  }
  function showModelProgress(text: string): void {
    ($("upModelProgress") as HTMLElement).classList.remove("hidden");
    ($("upModelBar") as HTMLElement).style.width = "0%";
    $("upModelText").textContent = text;
  }
  function updateModelProgress(p: DownloadProgress, label: string): void {
    const pct = p.total > 0 ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0;
    ($("upModelBar") as HTMLElement).style.width = pct + "%";
    $("upModelText").textContent = p.fromCache ? "Model sudah di HP — lagi disiapkan…" : label + " " + pct + "%";
  }
  function updateTileProgress(p: AiProgress): void {
    const pct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
    ($("upModelBar") as HTMLElement).style.width = pct + "%";
    $("upModelText").textContent = p.label + " — " + pct + "%";
  }
  function hideModelProgress(): void {
    ($("upModelProgress") as HTMLElement).classList.add("hidden");
  }

  /* ── Perbesar (Real-ESRGAN; Lanczos cuma fallback offline) ── */
  async function run(): Promise<void> {
    if (busy) return;
    busy = true;
    ($("upResultBar") as HTMLElement).classList.add("hidden");
    ($("upCompare") as HTMLElement).classList.add("hidden");
    ($("upRetry") as HTMLButtonElement).classList.add("hidden");
    setNote("");
    abort = new AbortController();
    try {
      const input = scale === 3 ? downscaleTo(work, WORK_MAX_3X) : work;
      const t0 = Date.now();
      let out: ImageData;
      let usedLanczos = false;
      try {
        showModelProgress("Lagi unduh model…");
        await ensureEngine("esrgan", {
          onDownload: (p) => updateModelProgress(p, "Lagi unduh model"),
          signal: abort.signal,
        });
        setNote("Lagi memperbesar pakai AI…");
        const res = await runAi<{ data: ArrayBuffer; w: number; h: number }>(
          "esrgan",
          { kind: "upscale", image: input, scale },
          (p) => updateTileProgress(p),
        );
        out = new ImageData(new Uint8ClampedArray(res.data), res.w, res.h);
      } catch (e) {
        if ((e as Error).message === "Dibatalkan") throw e;
        // Model tidak bisa diunduh (offline) — Lanczos diam-diam, jujur.
        usedLanczos = true;
        hideModelProgress();
        setNote("Mode offline — tanpa AI, hasilnya interpolasi biasa (tidak menciptakan detail).");
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        out = lanczosUpscale(input, scale);
      }
      exportBlob = await imageDataToBlob(out, outType);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = setPreviewImg(exportBlob);
      const ms = Date.now() - t0;
      setNote("Diperbesar " + scale + "× ✓ " + input.width + "×" + input.height + " → " + out.width + "×" + out.height +
        " (" + (ms / 1000).toFixed(1) + " dtk)" + (usedLanczos ? " — mode offline (interpolasi)." : " — AI.") +
        " Ketuk \"Lihat asli\" di bawah buat bandingkan.");
      ($("upResultBar") as HTMLElement).classList.remove("hidden");
      ($("upCompare") as HTMLElement).classList.remove("hidden");
    } catch (e) {
      if ((e as Error).message === "Dibatalkan") {
        hooks.onToast("Dibatalkan.");
        setNote("");
      } else {
        const msg = String((e as Error).message || "Gagal").replace(/\.+$/, "");
        hooks.onToast("Gagal memperbesar: " + msg + ". Coba lagi.");
        setNote("Gagal memperbesar: " + msg + ". Coba lagi.");
        ($("upRetry") as HTMLButtonElement).classList.remove("hidden");
      }
    }
    hideModelProgress();
    abort = null;
    busy = false;
  }

  /* ── Kontrol ── */
  $("upCancel").onclick = () => {
    abort?.abort();
    cancelAiJobs();
  };
  /* Segmented control: mengetuk 2×/3× LANGSUNG menjalankan (prinsip B).
     Assignment (.onclick), bukan addEventListener — modal dibuka berulang. */
  document.querySelectorAll("[data-up-scale]").forEach((b) => {
    (b as HTMLButtonElement).onclick = () => {
      if (busy) return;
      scale = (Number((b as HTMLElement).dataset.upScale) || 2) as Upscale;
      document.querySelectorAll("[data-up-scale]").forEach((x) =>
        x.setAttribute("aria-pressed", (x as HTMLElement).dataset.upScale === String(scale) ? "true" : "false"));
      $("upWarn3").classList.toggle("hidden", scale !== 3);
      void run();
    };
  });
  ($("upRetry") as HTMLButtonElement).onclick = () => {
    void run();
  };
  /* "Lihat asli" = toggle ketuk-sekali (prinsip I). */
  const cmp = $("upCompare") as HTMLButtonElement;
  let comparing = false;
  cmp.onclick = () => {
    comparing = !comparing;
    cmp.setAttribute("aria-pressed", comparing ? "true" : "false");
    if (comparing) showOriginal();
    else showResult();
  };
  $("upSave").onclick = () => {
    if (!exportBlob) return;
    hooks.onReplace(exportBlob);
    close();
  };
  $("upUndoResult").onclick = () => {
    exportBlob = null;
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }
    ($("upResultBar") as HTMLElement).classList.add("hidden");
    ($("upCompare") as HTMLElement).classList.add("hidden");
    setNote("");
    if (origUrl) preview.src = origUrl;
    hooks.onToast("Hasil diurungkan — kembali ke sebelum diperbesar.");
  };
  const origBtn = $("upUseOriginal");
  origBtn.classList.toggle("hidden", !opts.showUseOriginal);
  origBtn.onclick = () => {
    if (!busy) {
      close();
      hooks.onUseOriginal?.();
    }
  };

  function close(): void {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    if (origUrl) {
      URL.revokeObjectURL(origUrl);
      origUrl = null;
    }
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }
  }
  $("upClose").onclick = () => {
    if (!busy) close();
  };
  modal.onclick = (e) => {
    if (e.target === modal && !busy) close();
  };

  /* ── Buka ── */
  $("upTitle").textContent = "Perbesar";
  modal.setAttribute("aria-label", "Perbesar");
  const bmp = await createImageBitmap(source.blob);
  const fw = bmp.width, fh = bmp.height;
  bmp.close();
  $("upSub").textContent =
    source.name + " · " + fw + "×" + fh + " · diedit dari " + (source.sourceLabel || "Asli");
  /* Engine dijelaskan sekali saja di deskripsi HTML (#upDesc) — jangan
     diulang di catatan dinamis (P2-03). */
  setNote("");
  ($("upResultBar") as HTMLElement).classList.add("hidden");
  ($("upCompare") as HTMLElement).classList.add("hidden");
  $("upWarn3").classList.add("hidden");
  // Preview awal = foto asli (kerja).
  const oc = canvasOf(work.width, work.height);
  (oc.getContext("2d") as CanvasRenderingContext2D).putImageData(work, 0, 0);
  origUrl = await new Promise<string>((res, rej) =>
    oc.toBlob((b) => (b ? res(URL.createObjectURL(b)) : rej(new Error("Gagal preview."))), "image/png"));
  preview.src = origUrl;
  previewUrl = origUrl;
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  /* Default 2× jalan sendiri begitu dibuka (prinsip B). */
  void run();
}
