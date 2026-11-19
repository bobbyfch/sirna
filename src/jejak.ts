/* Hapus Jejak — cari & hapus jejak privasi di dalam file foto, 100%
   lokal, tanpa model, tanpa download. Jejak = metadata yang bisa
   mengidentifikasi pemilik/waktu/lokasi: EXIF (kamera, waktu, GPS),
   IPTC, XMP, teks PNG (prompt/seed), profil ICC, komentar JPEG.
   Pindai murni atas byte file (tanpa DOM); hapusnya lewat hook onScrub
   dari app.ts (strip lossless yang sama dengan Bersihkan + jalur canvas
   kalau jejak masih kebaca) — lalu di-scan ulang, hasilnya jujur.
   Nama file (mis. IMG_20261118_143201.jpg) DITAMPILKAN sebagai jejak
   info — nama tidak diubah alat ini; ganti manual sebelum dibagikan. */

import type { EraseSource, EraseHooks } from "./erase";

export interface Trace {
  kind: string; // "exif" | "gps" | "iptc" | "xmp" | "pngtext" | "icc" | "time" | "comment" | "filename"
  label: string; // "GPS (lokasi)" — tampil di daftar
  detail: string; // "POCO F6 · 18 Nov 2026 14:32" — bukti, bukan klaim
}

export interface JejakHooks extends EraseHooks {
  onScrub: (blob: Blob) => Promise<Blob>; // strip jejak (app.ts), hasil di-scan ulang di sini
}

/* ── Pindai jejak di dalam byte file ── */
function ascii(b: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = b[off + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}
/* Parser TIFF minimal: cuma tag yang mengidentifikasi (Make/Model/
   DateTime/Software + ada-tidaknya GPS IFD). */
function parseExif(b: Uint8Array, off: number, len: number, out: Trace[]): void {
  if (len < 8) return;
  const le = b[off] === 0x49 && b[off + 1] === 0x49; // "II" = little-endian
  if (!le && !(b[off] === 0x4d && b[off + 1] === 0x4d)) return;
  const u16 = (o: number): number => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number): number =>
    le ? b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | b[o + 3] * 0x1000000
      : (b[o] * 0x1000000) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
  const ifd0 = off + u32(off + 4);
  if (ifd0 + 2 > off + len) return;
  const n = u16(ifd0);
  const vals: Record<number, string> = {};
  let gpsOff = -1;
  for (let i = 0; i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > off + len) break;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const valOff = count <= 4 && type === 2 ? e + 8 : off + u32(e + 8);
    if (tag === 0x8825) { gpsOff = off + u32(e + 8); continue; }
    if (type === 2 && (tag === 0x010f || tag === 0x0110 || tag === 0x0132 || tag === 0x0131)) {
      vals[tag] = ascii(b, valOff, Math.min(count, 64)).trim();
    }
  }
  const parts: string[] = [];
  if (vals[0x010f] || vals[0x0110]) parts.push([vals[0x010f], vals[0x0110]].filter(Boolean).join(" "));
  if (vals[0x0132]) parts.push(vals[0x0132]);
  if (vals[0x0131]) parts.push(vals[0x0131]);
  out.push({ kind: "exif", label: "EXIF (kamera & waktu)", detail: parts.join(" · ") || "ada data EXIF" });
  if (gpsOff >= 0) {
    // Baca koordinat dari GPS IFD (biar user lihat lokasi apa yang bocor).
    const rat = (o: number): number => { const d = u32(o + 4); return d === 0 ? 0 : u32(o) / d; };
    const fmt = (deg: number, min: number, sec: number, ref: string): string =>
      (Math.round(deg * 100) / 100) + "°" + (Math.round(min * 100) / 100) + "′" + (Math.round(sec * 100) / 100) + "″" + ref;
    let lat = "", lon = "";
    if (gpsOff + 2 <= off + len) {
      const gn = u16(gpsOff);
      let latRef = "", lonRef = "", latOff = -1, lonOff = -1;
      for (let i = 0; i < gn; i++) {
        const e = gpsOff + 2 + i * 12;
        if (e + 12 > off + len) break;
        const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
        const vOff = type === 2 && count <= 4 ? e + 8 : off + u32(e + 8);
        if (tag === 0x0001) latRef = ascii(b, vOff, 2);
        else if (tag === 0x0003) lonRef = ascii(b, vOff, 2);
        else if (tag === 0x0002 && count >= 3) latOff = vOff;
        else if (tag === 0x0004 && count >= 3) lonOff = vOff;
      }
      if (latOff >= 0) lat = fmt(rat(latOff), rat(latOff + 8), rat(latOff + 16), latRef);
      if (lonOff >= 0) lon = fmt(rat(lonOff), rat(lonOff + 8), rat(lonOff + 16), lonRef);
    }
    const coord = [lat, lon].filter(Boolean).join(", ");
    out.push({ kind: "gps", label: "GPS (lokasi)", detail: coord ? coord : "koordinat lokasi tersimpan di file" });
  }
}

function scanPng(b: Uint8Array, out: Trace[]): void {
  let pos = 8;
  let textCount = 0, textFirst = "";
  while (pos + 8 <= b.length) {
    const len = (b[pos] * 0x1000000) + (b[pos + 1] << 16) + (b[pos + 2] << 8) + b[pos + 3];
    if (len < 0 || pos + 12 + len > b.length) break;
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    const data = pos + 8;
    if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
      textCount++;
      if (!textFirst) textFirst = ascii(b, data, Math.min(len, 40)).split("\0")[0];
    } else if (type === "eXIf") {
      parseExif(b, data, len, out);
    } else if (type === "tIME") {
      out.push({ kind: "time", label: "Waktu pembuatan (PNG)", detail: "chunk tIME tersimpan di file" });
    } else if (type === "iCCP") {
      out.push({ kind: "icc", label: "Profil warna (ICC)", detail: "chunk iCCP — deskripsinya bisa berisi teks" });
    }
    if (type === "IEND") break;
    pos += 12 + len;
  }
  if (textCount > 0) {
    out.unshift({ kind: "pngtext", label: "Teks PNG (" + textCount + " chunk)", detail: textFirst ? "mis. “" + textFirst + "”" : "teks tersimpan di dalam file" });
  }
}

function scanJpeg(b: Uint8Array, out: Trace[]): void {
  let pos = 2;
  while (pos + 2 <= b.length) {
    while (pos + 1 < b.length && b[pos] === 0xff && b[pos + 1] === 0xff) pos++;
    if (b[pos] !== 0xff) break;
    const marker = b[pos + 1];
    if (marker === 0xd9) break; // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    if (pos + 4 > b.length) break;
    const len = (b[pos + 2] << 8) | b[pos + 3];
    if (len < 2 || pos + 2 + len > b.length) break;
    const data = pos + 4, segLen = len - 2; // payload mulai setelah marker (2) + panjang (2)
    if (marker === 0xe1) {
      // ascii() berhenti di byte NUL, jadi "Exif\0\0" terbaca "Exif".
      if (ascii(b, data, 6) === "Exif") parseExif(b, data + 6, segLen - 6, out);
      else if (ascii(b, data, 29).startsWith("http://ns.adobe.com/xap/1.0/")) {
        out.push({ kind: "xmp", label: "XMP", detail: "metadata Adobe XMP" });
      }
    } else if (marker === 0xed) {
      out.push({ kind: "iptc", label: "IPTC / Photoshop", detail: "segmen APP13" });
    } else if (marker === 0xe2) {
      out.push({ kind: "icc", label: "Profil warna (ICC)", detail: "segmen APP2 — deskripsinya bisa berisi teks" });
    } else if (marker === 0xfe) {
      out.push({ kind: "comment", label: "Komentar (COM)", detail: "“" + ascii(b, data, Math.min(segLen, 40)) + "”" });
    }
    if (marker === 0xda) break; // SOS — data gambar, berhenti
    pos += 2 + len;
  }
}

function scanWebp(b: Uint8Array, out: Trace[]): void {
  let pos = 12;
  while (pos + 8 <= b.length) {
    const type = String.fromCharCode(b[pos], b[pos + 1], b[pos + 2], b[pos + 3]);
    const len = b[pos + 4] | (b[pos + 5] << 8) | (b[pos + 6] << 16) | (b[pos + 7] << 24);
    if (pos + 8 + len > b.length) break;
    if (type === "EXIF") parseExif(b, pos + 8, len, out);
    else if (type === "XMP ") out.push({ kind: "xmp", label: "XMP", detail: "metadata Adobe XMP" });
    else if (type === "ICCP") out.push({ kind: "icc", label: "Profil warna (ICC)", detail: "chunk ICCP" });
    pos += 8 + len + (len % 2);
  }
}

export async function scanTraces(blob: Blob): Promise<Trace[]> {
  const ab = await blob.arrayBuffer();
  const b = new Uint8Array(ab);
  const out: Trace[] = [];
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50) scanPng(b, out);
  else if (b.length >= 2 && b[0] === 0xff && b[1] === 0xd8) scanJpeg(b, out);
  else if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) scanWebp(b, out);
  return out;
}

/* Nama file yang mengandung tanggal/kode (IMG_20261118_143201.jpg,
   Screenshot_2026-11-18, DSC_0042) — info saja, alat ini tidak
   mengubah nama file. */
export function filenameTrace(name: string): Trace | null {
  if (/(20\d{2}[-_]?\d{2}[-_]?\d{2}|IMG_|DSC_|Screenshot|Screenshot_)/i.test(name)) {
    return { kind: "filename", label: "Nama file", detail: "“" + name + "” mengandung tanggal/kode — ganti manual sebelum dibagikan" };
  }
  return null;
}

/* ── Modal ── */
function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

export interface JejakOptions {
  showUseOriginal?: boolean;
}

export async function openJejak(source: EraseSource, hooks: JejakHooks, opts: JejakOptions = {}): Promise<void> {
  const modal = $("jejakModal");

  let busy = false;
  let exportBlob: Blob | null = null;
  let blobTraces: Trace[] = [];

  function setNote(t: string): void {
    $("jejakNote").textContent = t;
  }
  function renderList(traces: Trace[], fileTrace: Trace | null): void {
    const el = $("jejakList");
    const rows = traces.map((t) =>
      '<div class="jejak-row"><span class="jejak-ic" aria-hidden="true">!</span><div class="min-w-0"><b>' + esc(t.label) + '</b><span>' + esc(t.detail) + '</span></div></div>').join("");
    const fileRow = fileTrace
      ? '<div class="jejak-row jejak-file"><span class="jejak-ic" aria-hidden="true">i</span><div class="min-w-0"><b>' + esc(fileTrace.label) + '</b><span>' + esc(fileTrace.detail) + '</span></div></div>'
      : "";
    el.innerHTML = rows + fileRow ||
      '<p class="jejak-empty">Tidak ada jejak di dalam file — sudah bersih.</p>';
    if (rows + fileRow === "") el.innerHTML = '<p class="jejak-empty">Tidak ada jejak di dalam file — sudah bersih.</p>';
  }
  function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ── Hapus jejak: jalan otomatis begitu jejak ketemu (prinsip A) ── */
  async function run(): Promise<void> {
    if (busy || blobTraces.length === 0) return;
    busy = true;
    ($("jejakResultBar") as HTMLElement).classList.add("hidden");
    ($("jejakRetry") as HTMLButtonElement).classList.add("hidden");
    setNote("Lagi ngitung…");
    try {
      const out = await hooks.onScrub(source.blob);
      const after = await scanTraces(out);
      exportBlob = out;
      if (after.length === 0) {
        blobTraces = [];
        renderList([], filenameTrace(source.name));
        setNote("Jejak dihapus ✓ Dicek ulang: 0 jejak tersisa di dalam file.");
        ($("jejakResultBar") as HTMLElement).classList.remove("hidden");
      } else {
        blobTraces = after;
        renderList(after, filenameTrace(source.name));
        setNote("Masih ada " + after.length + " jejak: " + after.map((t) => t.label).join(", ") + ". Coba lagi.");
        exportBlob = null;
      }
    } catch (e) {
      const msg = String((e as Error).message || "Gagal").replace(/\.+$/, "");
      hooks.onToast("Gagal hapus jejak: " + msg + ". Coba lagi.");
      setNote("Gagal hapus jejak: " + msg + ". Coba lagi.");
      ($("jejakRetry") as HTMLButtonElement).classList.remove("hidden");
    }
    busy = false;
  }

  /* ── Kontrol ── */
  ($("jejakRetry") as HTMLButtonElement).onclick = () => {
    void run();
  };
  $("jejakSave").onclick = () => {
    if (!exportBlob) return;
    hooks.onReplace(exportBlob);
    close();
  };
  $("jejakUndoResult").onclick = () => {
    exportBlob = null;
    ($("jejakResultBar") as HTMLElement).classList.add("hidden");
    setNote(blobTraces.length === 0 ? "Jejak dihapus ✓ Dicek ulang: 0 jejak tersisa di dalam file." : "Ketemu " + blobTraces.length + " jejak di dalam file ini.");
    hooks.onToast("Hasil diurungkan — kembali ke sebelum dihapus.");
  };
  const origBtn = $("jejakUseOriginal");
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
  }
  $("jejakClose").onclick = () => {
    if (!busy) close();
  };
  modal.onclick = (e) => {
    if (e.target === modal && !busy) close();
  };

  /* ── Buka: pindai dulu, baru tampil ── */
  $("jejakTitle").textContent = "Hapus Jejak";
  modal.setAttribute("aria-label", "Hapus Jejak");
  const bmp = await createImageBitmap(source.blob);
  const fw = bmp.width, fh = bmp.height;
  bmp.close();
  $("jejakSub").textContent =
    source.name + " · " + fw + "×" + fh + " · diedit dari " + (source.sourceLabel || "Asli");
  setNote("Lagi memindai jejak…");
  blobTraces = await scanTraces(source.blob);
  const fileTrace = filenameTrace(source.name);
  renderList(blobTraces, fileTrace);
  if (blobTraces.length === 0) {
    setNote("Tidak ada jejak di dalam file — sudah bersih." + (fileTrace ? " Nama file masih mengandung tanggal/kode, ganti manual sebelum dibagikan." : ""));
  } else {
    setNote("Ketemu " + blobTraces.length + " jejak di dalam file ini — lagi dihapus…");
  }
  ($("jejakResultBar") as HTMLElement).classList.add("hidden");
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  /* Jejak ketemu = langsung dihapus, tanpa ketuk lagi (prinsip A). */
  if (blobTraces.length > 0) void run();
}
