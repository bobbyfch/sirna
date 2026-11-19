/* Hapus Latar — SATU engine: ORMBG int8 (44 MB, Apache-2.0).
   Diunduh sekali saat alat dibuka, tersimpan di Cache Storage,
   inferensi di Web Worker (src/models.ts + src/ai-worker.ts).
   Inferensi di 1024x1024 (RGB/255, tanpa normalisasi ImageNet);
   output `alphas` sudah probabilitas [0,1] — tanpa sigmoid.
   Mask di-upscale kembali ke ukuran penuh (bilinear) + edge-feather
   (box blur) — post-pass wajib untuk pinggir rambut yang halus.
   Menggantikan Hapus Latar Polos (chroma-key) yang dihapus 19 Nov 2026:
   model INI alatnya — latar apa pun (orang, produk, ilustrasi), bukan
   cuma latar satu warna. Tidak ada fallback offline: kalau model tidak
   bisa diunduh, alatnya gagal dengan pesan jujur (butuh internet sekali).
   Hasilnya PNG transparan, preview di atas checkerboard. */

import type { EraseSource, EraseHooks } from "./erase";
import { ensureEngine, runAi, cancelAiJobs, type DownloadProgress } from "./models";

/* ── Util gambar ── */
function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
async function blobToImageData(blob: Blob, maxSide: number): Promise<{ img: ImageData; scale: number }> {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { img: ctx.getImageData(0, 0, w, h), scale: s };
}
/* Gambar inferensi: ORMBG fixed-shape — input HARUS tepat 1024x1024
   (input lain ditolak ORT: "Got invalid dimensions... Expected: 1024").
   Resize stretch ke 1024x1024 (sesuai preprocessor ORMBG: resize +
   bilinear, tanpa padding); mask hasil stretch dikembalikan ke aspek
   asli saat upscale — geometrinya saling meniadakan. */
async function blobToImageDataExact(blob: Blob, w: number, h: number): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return ctx.getImageData(0, 0, w, h);
}
function imageDataToBlob(d: ImageData): Promise<Blob> {
  const c = canvasOf(d.width, d.height);
  (c.getContext("2d") as CanvasRenderingContext2D).putImageData(d, 0, 0);
  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Gagal encode PNG."))), "image/png"));
}

/* Upscale mask 1024 -> ukuran penuh via canvas (bilinear, smoothing high). */
function upscaleMask(mask: Float32Array, mw: number, mh: number, w: number, h: number): Float32Array {
  const c = canvasOf(mw, mh);
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  const id = ctx.createImageData(mw, mh);
  for (let i = 0; i < mw * mh; i++) {
    const v = Math.max(0, Math.min(255, Math.round(mask[i] * 255)));
    id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  const c2 = canvasOf(w, h);
  const ctx2 = c2.getContext("2d") as CanvasRenderingContext2D;
  ctx2.imageSmoothingEnabled = true;
  ctx2.imageSmoothingQuality = "high";
  ctx2.drawImage(c, 0, 0, w, h);
  const out = ctx2.getImageData(0, 0, w, h).data;
  const res = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) res[i] = out[i * 4] / 255;
  return res;
}

/* Edge-feather: box blur separable di alpha (radius 2) — melembutkan
   pinggir mask hasil upscale supaya tidak "guntingan kertas". */
function featherMask(alpha: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = 2 * radius + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      const xx = Math.min(w - 1, Math.max(0, x));
      sum += alpha[y * w + xx];
    }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / win;
      const xOut = x - radius, xIn = x + radius + 1;
      sum += alpha[y * w + Math.min(w - 1, Math.max(0, xIn))] - alpha[y * w + Math.min(w - 1, Math.max(0, xOut))];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      const yy = Math.min(h - 1, Math.max(0, y));
      sum += tmp[yy * w + x];
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      const yOut = y - radius, yIn = y + radius + 1;
      sum += tmp[Math.min(h - 1, Math.max(0, yIn)) * w + x] - tmp[Math.min(h - 1, Math.max(0, yOut)) * w + x];
    }
  }
  return out;
}

function applyAlpha(img: ImageData, alpha: Float32Array): ImageData {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  for (let i = 0; i < alpha.length; i++) out.data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(alpha[i] * 255)));
  return out;
}

/* ── Modal ── */
function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

export interface BgOptions {
  showUseOriginal?: boolean;
}

const INFER_MAX = 1024; // sisi panjang maks inferensi ORMBG
const PREVIEW_MAX = 1024; // sisi panjang maks kanvas kerja preview
const EXPORT_MAX = 2048; // sisi panjang maks ekspor (hemat RAM HP)

export async function openBackground(source: EraseSource, hooks: EraseHooks, opts: BgOptions = {}): Promise<void> {
  const modal = $("bgModal");
  const preview = $("bgPreview") as HTMLImageElement;

  // Gambar kerja (preview) — inferensi jalan sekali di 1024, mask-nya
  // dipakai buat preview dan ekspor resolusi penuh.
  const work = await blobToImageData(source.blob, PREVIEW_MAX);
  const img = work.img;
  const ow = img.width, oh = img.height;

  let busy = false;
  let exportBlob: Blob | null = null;
  let previewUrl: string | null = null;
  let resultUrl: string | null = null;
  let lastRemoved = 0;
  let abort: AbortController | null = null;

  function setPreviewImg(blob: Blob): void {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    preview.src = previewUrl;
  }
  function setNote(t: string): void {
    $("bgNote").textContent = t;
  }
  function showModelProgress(text: string): void {
    ($("bgModelProgress") as HTMLElement).classList.remove("hidden");
    ($("bgModelBar") as HTMLElement).style.width = "0%";
    $("bgModelText").textContent = text;
  }
  function updateModelProgress(p: DownloadProgress, label: string): void {
    const pct = p.total > 0 ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0;
    ($("bgModelBar") as HTMLElement).style.width = pct + "%";
    $("bgModelText").textContent = p.fromCache ? "Model sudah di HP — lagi disiapkan…" : label + " " + pct + "%";
  }
  function hideModelProgress(): void {
    ($("bgModelProgress") as HTMLElement).classList.add("hidden");
  }
  function removedNote(): string {
    if (lastRemoved < 0.005) return "Hampir tidak ada yang terhapus — mungkin subjeknya memenuhi foto, atau modelnya tidak yakin. Coba foto lain.";
    if (lastRemoved > 0.9) return "Hampir semuanya terhapus — modelnya tidak menemukan subjek yang jelas. Coba foto lain.";
    return "Latar dihapus ✓ Hasilnya PNG transparan — cek pinggir rambutnya, lalu Simpan hasil.";
  }

  /* ── Hapus latar: inferensi sekali di 1024, terapkan ke preview +
     ekspor resolusi penuh dari mask yang sama. ── */
  async function run(): Promise<void> {
    if (busy) return;
    busy = true;
    ($("bgResultBar") as HTMLElement).classList.add("hidden");
    ($("bgRetry") as HTMLButtonElement).classList.add("hidden");
    setNote("");
    abort = new AbortController();
    try {
      showModelProgress("Lagi unduh model…");
      await ensureEngine("ormbg", {
        onDownload: (p) => updateModelProgress(p, "Lagi unduh model"),
        signal: abort.signal,
      });
      hideModelProgress();
      setNote("Lagi hapus latar pakai AI…");
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // Inferensi di 1024x1024 TEPAT (fixed-shape — lihat helper di atas).
      const inferImg = await blobToImageDataExact(source.blob, INFER_MAX, INFER_MAX);
      const out = await runAi<{ data: ArrayBuffer; w: number; h: number }>("ormbg", { kind: "bg", image: inferImg });
      const mask1024 = new Float32Array(out.data);
      // Preview (work-res).
      const maskWork = upscaleMask(mask1024, out.w, out.h, ow, oh);
      const featheredWork = featherMask(maskWork, ow, oh, 2);
      const previewImg = applyAlpha(new ImageData(new Uint8ClampedArray(img.data), ow, oh), featheredWork);
      setPreviewImg(await imageDataToBlob(previewImg));
      // Ekspor resolusi penuh (maks 2048) dari mask yang sama.
      const full = await blobToImageData(source.blob, EXPORT_MAX);
      const maskFull = upscaleMask(mask1024, out.w, out.h, full.img.width, full.img.height);
      const featheredFull = featherMask(maskFull, full.img.width, full.img.height, 2);
      let removed = 0;
      for (let i = 0; i < featheredFull.length; i++) if (featheredFull[i] < 0.5) removed++;
      lastRemoved = removed / featheredFull.length;
      exportBlob = await imageDataToBlob(applyAlpha(full.img, featheredFull));
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(exportBlob);
      preview.src = resultUrl;
      setNote(removedNote());
      ($("bgResultBar") as HTMLElement).classList.remove("hidden");
    } catch (e) {
      if ((e as Error).message === "Dibatalkan") {
        hooks.onToast("Dibatalkan.");
        setNote("");
      } else {
        const msg = String((e as Error).message || "Gagal").replace(/\.+$/, "");
        hooks.onToast("Gagal hapus latar: " + msg + ". Hapus Latar butuh internet sekali buat unduh model — coba lagi pas online.");
        setNote("Gagal hapus latar: " + msg + ". Hapus Latar butuh internet sekali buat unduh model — coba lagi pas online.");
        ($("bgRetry") as HTMLButtonElement).classList.remove("hidden");
      }
    }
    hideModelProgress();
    abort = null;
    busy = false;
  }

  /* ── Kontrol ── */
  $("bgCancel").onclick = () => {
    abort?.abort();
    cancelAiJobs();
  };
  ($("bgRetry") as HTMLButtonElement).onclick = () => {
    void run();
  };
  $("bgSave").onclick = () => {
    if (!exportBlob) return;
    hooks.onReplace(exportBlob);
    close();
  };
  $("bgUndoResult").onclick = async () => {
    exportBlob = null;
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }
    ($("bgResultBar") as HTMLElement).classList.add("hidden");
    setNote("");
    setPreviewImg(source.blob);
    hooks.onToast("Hasil diurungkan — kembali ke sebelum dihapus.");
  };
  const origBtn = $("bgUseOriginal");
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
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }
  }
  $("bgClose").onclick = () => {
    if (!busy) close();
  };
  modal.onclick = (e) => {
    if (e.target === modal && !busy) close();
  };

  /* ── Buka ── */
  $("bgTitle").textContent = "Hapus Latar";
  modal.setAttribute("aria-label", "Hapus Latar");
  /* B1: subhead nyebut sumber gambar — asli atau hasil alat mana. */
  const bmp = await createImageBitmap(source.blob);
  const fw = bmp.width, fh = bmp.height;
  bmp.close();
  $("bgSub").textContent =
    source.name + " · " + fw + "×" + fh + " · diedit dari " + (source.sourceLabel || "Asli");
  /* Engine dijelaskan sekali saja di deskripsi HTML (#bgDesc) — jangan
     diulang di catatan dinamis (P2-03). */
  setNote("Lagi hapus latar…");
  ($("bgResultBar") as HTMLElement).classList.add("hidden");
  setPreviewImg(source.blob);
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  /* Alat tanpa input jalan sendiri begitu dibuka (prinsip A). */
  void run();
}
