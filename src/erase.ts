/* Hapus Objek / Magic Eraser — editor + mesin inpainting.
   SATU engine: Mi-GAN (migan_pipeline_v2.onnx, 28,1 MB, MIT) —
   diunduh sekali saat alat dibuka, tersimpan di Cache Storage,
   inferensi di Web Worker (src/models.ts + src/ai-worker.ts).
   Mask: 1 = lubang; tensor ke model DIBALIK (255 = diketahui,
   0 = lubang) — lihat tests/model-smoke.mjs.
   Telea (src/telea.ts) BUKAN mode — cuma fallback diam-diam kalau
   model tidak bisa diunduh (offline), dengan teks status yang jujur. */

import { inpaintTelea, dilateMask } from "./telea";
import { ensureEngine, runAi, cancelAiJobs, type DownloadProgress } from "./models";

const MAX_WORK = 2048; // sisi panjang maks. kanvas kerja editor

/* ── Util gambar ── */
function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function imageDataToCanvas(d: ImageData): HTMLCanvasElement {
  const c = canvasOf(d.width, d.height);
  (c.getContext("2d") as CanvasRenderingContext2D).putImageData(d, 0, 0);
  return c;
}

/* ═══════════ Editor ═══════════ */
export interface EraseSource {
  name: string; // nama file asal
  blob: Blob; // gambar yang diedit (hasil bersih kalau ada, kalau tidak file asli)
  type: string; // mime hasil bersih / asli
  suggestName: string; // nama file buat Simpan/Unduh (ikut setelan -clean / Sama)
  sourceLabel?: string; // B1: dari mana gambar ini — "Asli" / "hasil Bersihkan" / "hasil Hapus Objek" / "hasil Hapus Watermark"
}
export interface EraseHooks {
  onReplace: (blob: Blob) => void; // jadikan hasil ini file bersih yang baru
  onToast: (msg: string) => void;
  onUseOriginal?: () => void; // "Mulai dari file asli" ditekan (Langkah 3)
  onScrub?: (blob: Blob) => Promise<Blob>; // Hapus Jejak: strip jejak privasi (app.ts)
}

export interface EraseOptions {
  title?: string; // judul modal — default "Hapus Objek"
  /* Mask awal (mis. hasil deteksi watermark): dipanggil sekali pas gambar
     kerja sudah dimuat; kalau mengembalikan mask, mask itu langsung
     ditandain merah dan `painted` jadi true — user tinggal tekan Hapus
     atau ngubah dulu pakai kuas. null = tidak ketemu, mode manual. */
  initialMask?: (img: ImageData) => { mask: Uint8Array<ArrayBuffer>; note: string } | null;
  noMaskNote?: string; // catatan kalau initialMask mengembalikan null
  showUseOriginal?: boolean; // tampilkan tombol "Mulai dari file asli" (sumbernya bukan asli)
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

  let brush = 48;
  let busy = false;
  let exportBlob: Blob | null = null;
  let exportType = source.type === "image/jpeg" ? "image/jpeg" : source.type === "image/webp" ? "image/webp" : "image/png";
  /* Keadaan pra-run: hasil buruk bisa diurungkan (P0 §5.3). */
  let preRun: { image: ImageData; mask: Uint8Array<ArrayBuffer>; exportBlob: Blob | null } | null = null;
  /* "Tahan: lihat asli" membandingkan hasil vs gambar sebelum run terakhir
     (bukan vs file asli saja) — setelah Hapus, yang relevan adalah
     "sebelum dihapus barusan". */
  let compareBase: ImageData = sessionOriginal;

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
    updateMaskWarn();
    updateRunState();
  }
  function renderDisplay(): void {
    dctx.putImageData(current, 0, 0);
  }
  function setNote(t: string): void { $("eraseNote").textContent = t; }
  function setRunLabel(t: string, disabled: boolean): void {
    const b = $("eraseRun") as HTMLButtonElement;
    b.textContent = t; b.disabled = disabled;
  }

  /* ── Progres unduhan model (deterministic, + Batalkan) ── */
  function showModelProgress(text: string): void {
    ($("eraseModelProgress") as HTMLElement).classList.remove("hidden");
    ($("eraseModelBar") as HTMLElement).style.width = "0%";
    $("eraseModelText").textContent = text;
  }
  function updateModelProgress(p: DownloadProgress, label: string): void {
    const pct = p.total > 0 ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0;
    ($("eraseModelBar") as HTMLElement).style.width = pct + "%";
    $("eraseModelText").textContent = p.fromCache ? "Model sudah di HP — lagi disiapkan…" : label + " " + pct + "%";
  }
  function hideModelProgress(): void {
    ($("eraseModelProgress") as HTMLElement).classList.add("hidden");
  }

  /* ── Penjaga mask besar + status langkah ── */
  const MASK_WARN_FRAC = 0.02; // >2% foto = AI lebih lambat & hasilnya bisa lembut
  function maskFrac(): number {
    let n = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
    return n / (ww * wh);
  }
  function updateMaskWarn(): void {
    const w = $("eraseMaskWarn");
    const frac = maskFrac();
    const show = painted && frac > MASK_WARN_FRAC;
    w.classList.toggle("hidden", !show);
    if (show) $("eraseMaskWarnText").textContent = "Coretannya besar (" + Math.round(frac * 100) + "% foto) — AI butuh waktu lebih lama dan hasilnya bisa lembut. Coba bagi jadi beberapa bagian kalau hasilnya kurang tajam.";
  }
  function updateRunState(): void {
    const b = $("eraseRun") as HTMLButtonElement;
    if (!busy) b.disabled = !painted || !mask.some((v) => v);
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
  display.onpointerdown = (e) => {
    if (busy) return;
    e.preventDefault();
    display.setPointerCapture(e.pointerId);
    undoStack.push(mask.slice());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    painting = true;
    [lastX, lastY] = evtPos(e);
    strokeTo(lastX, lastY);
    $("eraseResultBar").classList.add("hidden");
  };
  display.onpointermove = (e) => {
    if (!painting || busy) return;
    e.preventDefault();
    const [x, y] = evtPos(e);
    strokeTo(x, y);
  };
  function endStroke(): void { painting = false; mask = readMask(); renderOverlay(); updateMaskWarn(); updateRunState(); }
  display.onpointerup = endStroke;
  display.onpointercancel = endStroke;

  /* ── Toolbar ── */
  const brushInput = $("eraseBrush") as HTMLInputElement;
  brushInput.oninput = () => {
    brush = parseInt(brushInput.value, 10) || 48;
    $("eraseBrushVal").textContent = brush + " px";
  };
  ($("eraseUndo") as HTMLButtonElement).onclick = () => {
    const prev = undoStack.pop();
    if (!prev) { hooks.onToast("Nggak ada yang bisa diurungkan."); return; }
    applyMask(prev);
    updateRunState();
  };
  ($("eraseClear") as HTMLButtonElement).onclick = () => {
    undoStack.push(mask.slice());
    mask = new Uint8Array(ww * wh);
    mctx.clearRect(0, 0, ww, wh);
    renderOverlay();
    setNote("");
    updateMaskWarn();
    updateRunState();
  };
  // Bandingkan: toggle "Lihat asli" — ketuk sekali buat lihat gambar
  // sebelum run terakhir (atau asli kalau belum pernah Hapus di sesi
  // ini), ketuk lagi buat balik ke hasil.
  const cmp = $("eraseCompare") as HTMLButtonElement;
  let comparing = false;
  cmp.onclick = () => {
    comparing = !comparing;
    cmp.setAttribute("aria-pressed", comparing ? "true" : "false");
    if (comparing) { dctx.putImageData(compareBase, 0, 0); octx.clearRect(0, 0, ww, wh); }
    else { renderDisplay(); renderOverlay(); }
  };

  /* ── Composite-back: hasil kerja ditempel ke ukuran penuh, luar mask
     tetap byte-identical dengan file asli. Mask yang dipakai run
     (sudah didilasi) diteruskan eksplisit — JANGAN baca maskCanvas di
     sini: kanvas itu dibersihkan setelah run buat coretan berikutnya,
     dan kalau buildExport dipanggil sesudahnya hasilnya = file asli
     (bug Nov 2026: Simpan/Unduh diam-diam membuang hasil hapus). ── */
  async function buildExport(result: ImageData, runMask: Uint8Array<ArrayBuffer>): Promise<Blob> {
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
    // Mask run -> kanvas ukuran penuh (smoothing aktif: tepi mask lembut).
    const mC = canvasOf(ww, wh);
    const mc = mC.getContext("2d") as CanvasRenderingContext2D;
    const md = mc.createImageData(ww, wh);
    for (let i = 0; i < ww * wh; i++) { const v = runMask[i] ? 255 : 0; md.data[i * 4] = v; md.data[i * 4 + 1] = v; md.data[i * 4 + 2] = v; md.data[i * 4 + 3] = v; }
    mc.putImageData(md, 0, 0);
    const mFull = canvasOf(fw, fh);
    const mfctx = mFull.getContext("2d") as CanvasRenderingContext2D;
    mfctx.drawImage(mC, 0, 0, fw, fh);
    tctx.globalCompositeOperation = "destination-in";
    tctx.drawImage(mFull, 0, 0);
    tctx.globalCompositeOperation = "source-over";
    octx2.drawImage(tmp, 0, 0);
    const blob = await new Promise<Blob | null>((res) => outC.toBlob(res, exportType, 0.92));
    if (!blob) throw new Error("Gagal encode hasil.");
    return blob;
  }

  /* ── Hapus! (Mi-GAN; Telea cuma fallback offline, diam-diam) ── */
  let eraseAbort: AbortController | null = null;
  $("eraseCancel").onclick = () => {
    eraseAbort?.abort();
    cancelAiJobs();
  };
  ($("eraseRun") as HTMLButtonElement).onclick = async () => {
    if (busy) return;
    if (!painted || !mask.some((v) => v)) { hooks.onToast("Coret dulu area yang mau dihapus."); return; }
    busy = true;
    setRunLabel("Lagi hapus…", true);
    ($("eraseResultBar") as HTMLElement).classList.add("hidden");
    setNote("");
    const abort = new AbortController();
    eraseAbort = abort;
    // Biar "Lagi hapus…" sempat tampil sebelum kerja berat dimulai.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const m = dilateMask(mask, ww, wh, 1);
      const maskWasLarge = maskFrac() > MASK_WARN_FRAC;
      // Simpan keadaan pra-run: hasil buruk bisa diurungkan (P0 §5.3).
      preRun = { image: new ImageData(new Uint8ClampedArray(current.data), ww, wh), mask: mask.slice(), exportBlob };
      let usedTelea = false;
      let result: ImageData;
      try {
        showModelProgress("Lagi unduh model…");
        await ensureEngine("migan", {
          onDownload: (p) => updateModelProgress(p, "Lagi unduh model"),
          signal: abort.signal,
        });
        hideModelProgress();
        setNote("Lagi hapus pakai AI…");
        const out = await runAi<{ data: ArrayBuffer; w: number; h: number }>("migan", { kind: "inpaint", image: current, mask: m });
        result = new ImageData(new Uint8ClampedArray(out.data), out.w, out.h);
      } catch (e) {
        if ((e as Error).message === "Dibatalkan") throw e;
        // Model tidak bisa diunduh (offline / gagal) — fallback Telea
        // diam-diam, dengan teks status yang jujur.
        usedTelea = true;
        hideModelProgress();
        setNote("Mode offline — tanpa AI, hasilnya bisa kurang halus di coretan besar.");
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        result = new ImageData(inpaintTelea(current.data, m, ww, wh), ww, wh);
      }
      // Tempel hasil ke gambar kerja: luar mask = piksel kerja yang lama.
      const merged = new ImageData(new Uint8ClampedArray(current.data), ww, wh);
      for (let i = 0; i < ww * wh; i++) {
        if (m[i]) {
          for (let c = 0; c < 4; c++) merged.data[i * 4 + c] = result.data[i * 4 + c];
        }
      }
      current = merged;
      compareBase = preRun.image;
      renderDisplay();
      // Export DULU pakai mask run, baru bersihkan mask (lihat buildExport).
      exportBlob = await buildExport(current, m);
      // Mask habis dipakai: bersihin buat coretan berikutnya.
      // (undoStack TIDAK dikosongkan — coretan tetap bisa diurungkan.)
      mask = new Uint8Array(ww * wh);
      mctx.clearRect(0, 0, ww, wh);
      renderOverlay();
      const noun = (opts.title || "").includes("Watermark") ? "Watermark" : "Objek";
      setNote(noun + " dihapus ✓ Piksel di luar coretan tidak berubah." +
        (usedTelea ? " (mode offline — tanpa AI)" : "") +
        (maskWasLarge ? " Coretannya besar — hasilnya bisa lembut, coba bagi jadi beberapa bagian lain kali." : ""));
      ($("eraseResultBar") as HTMLElement).classList.remove("hidden");
      updateMaskWarn();
      updateRunState();
    } catch (e) {
      /* B17: gagal hapus — alasan + saran. */
      if ((e as Error).message === "Dibatalkan") {
        hooks.onToast("Dibatalkan.");
      } else {
        var failMsg = String((e as Error).message || "Gagal").replace(/\.+$/, "");
        hooks.onToast("Gagal hapus: " + failMsg + ". Coba lagi dengan coretan lebih kecil.");
      }
    }
    hideModelProgress();
    eraseAbort = null;
    busy = false;
    setRunLabel("Hapus", false);
    updateRunState();
  };

  /* Urungkan hasil: kembali ke gambar + coretan sebelum Hapus terakhir.
     Berbeda dengan "Urungkan" (coretan): ini membatalkan HASIL run. */
  ($("eraseUndoResult") as HTMLButtonElement).onclick = () => {
    if (!preRun) return;
    current = new ImageData(new Uint8ClampedArray(preRun.image.data), ww, wh);
    compareBase = sessionOriginal;
    exportBlob = preRun.exportBlob;
    const back = preRun.mask;
    preRun = null;
    applyMask(back);
    painted = true;
    ($("eraseResultBar") as HTMLElement).classList.add("hidden");
    renderDisplay();
    setNote("");
    updateMaskWarn();
    updateRunState();
    hooks.onToast("Hasil diurungkan — kembali ke sebelum dihapus.");
  };

  ($("eraseSave") as HTMLButtonElement).onclick = () => {
    if (!exportBlob) return;
    hooks.onReplace(exportBlob);
    close();
  };
  function close(): void {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }
  ($("eraseClose") as HTMLButtonElement).onclick = () => { if (!busy) close(); };
  modal.onclick = (e) => { if (e.target === modal && !busy) close(); };

  /* ── Buka ── */
  /* Judul selalu diatur (bukan cuma kalau opts.title ada) — kalau tidak,
     judul "Hapus Watermark" dari sesi sebelumnya nempel pas buka
     Hapus Objek sesudahnya. */
  $("eraseTitle").textContent = opts.title || "Hapus Objek";
  modal.setAttribute("aria-label", opts.title || "Hapus Objek");
  /* "Mulai dari file asli": muat ulang editor dari file asli (bukan hasil
     kerja saat ini). onclick (bukan addEventListener) biar nggak numpuk
     tiap buka editor; close() dulu, baru hook-nya buka ulang. */
  const origBtn = $("eraseUseOriginal");
  origBtn.classList.toggle("hidden", !opts.showUseOriginal);
  origBtn.onclick = () => { if (!busy) { close(); hooks.onUseOriginal?.(); } };
  /* B1: subhead nyebut sumber gambar — asli atau hasil alat mana. */
  $("eraseSub").textContent = source.name + " · " + ow + "×" + oh + " · diedit dari " + (source.sourceLabel || "Asli") + (ws < 1 ? " · kerja di " + ww + "×" + wh : "");
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
  updateRunState();
  updateMaskWarn();
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
