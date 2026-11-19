/* Edit Metadata — lihat, ubah & hapus metadata foto (EXIF, PNG text,
   XMP/IPTC, GPS). Hapus Jejak dilebur di sini sebagai aksi "Hapus jejak".
   Byte-logic + render panel; app.ts hanya memanggil openMetaFor() dan
   menyediakan container #metaPanel.

   Aturan tulis (DESIGN.md §6):
   - JPEG EXIF: edit nilai ASCII in-place BILA MUAT dalam alokasi lama
     (panjang lama termasuk NUL); bila tidak muat, field dilewati dengan
     pesan jujur ("hapus saja") — Terapkan tetap jalan untuk field lain.
     Hapus field = buang entri IFD + rebuild TIFF dengan offset dihitung
     ulang (bukan splice mentah — offset nilai di luar IFD ikut bergeser).
     Nilai kosong ("") = hapus field.
   - JPEG segmen (XMP/IPTC/COM): hapus = buang segmen utuh; COM bisa
     diedit (segmen di-rebuild).
   - PNG: chunk tEXt/iTXt di-rebuild (CRC32 dihitung ulang); eXIf/tIME/
     iCCP dihapus utuh.
   - WebP: chunk EXIF/XMP/ICCP dihapus utuh (RIFF di-rebuild).
   - Setelah tulis: panel selalu di-render ulang dari blob baru (re-scan),
     tidak pernah menampilkan klaim tanpa bukti byte.
   - Panel bekerja pada DRAFT di memori (CLEAN→DIRTY→SAVING→SAVED);
     "Hapus jejak" TIDAK memakai draft — langsung jalan + versi baru. */

import { scanTraces, filenameTrace, type Trace } from "./jejak";

export type MetaKind =
  | "file"
  | "exif-ascii" // JPEG EXIF ASCII (IFD0 / Exif IFD) — edit in-place bila muat, hapus
  | "exif-gps" // pointer GPS di IFD0 — hapus saja
  | "jpeg-seg" // segmen APP1 XMP / APP13 IPTC — hapus saja
  | "jpeg-com" // segmen COM — edit (rebuild) / hapus
  | "png-chunk" // chunk PNG — tEXt/iTXt edit+hapus, eXIf/tIME/iCCP hapus
  | "webp-chunk"; // chunk WebP EXIF/XMP/ICCP — hapus saja

export interface MetaField {
  id: string;
  group: string; // "File" | "EXIF" | "GPS" | "PNG text" | "XMP / IPTC" | "Komentar" | "Waktu"
  label: string;
  value: string; // nilai penuh (input edit menampilkan ini, bukan yang terpotong)
  editable: boolean;
  deletable: boolean;
  kind: MetaKind;
  // Penanda byte (dipakai applyFieldEdits):
  tag?: number; // tag EXIF (0x010F dst.)
  ifd?: "ifd0" | "exif"; // IFD tempat entri berada
  seg?: "xmp" | "iptc" | "com"; // segmen JPEG
  chunkType?: string; // tipe chunk PNG/WebP
  chunkIndex?: number; // urutan chunk sejenis (0-based)
  keyword?: string; // keyword tEXt/iTXt
}

export interface FieldEdit {
  id: string;
  action: "edit" | "delete";
  value?: string;
}

export interface MetaHooks {
  onReplace: (blob: Blob, doneText: string) => Promise<void>; // commit hasil sebagai versi "Metadata"
  onScrub: (blob: Blob) => Promise<Blob>; // strip jejak (app.ts: scrubTracesBlob)
  onToast: (msg: string) => void;
}

/* ── Util ── */
function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function sniffKind(ab: ArrayBuffer): string {
  const b = new Uint8Array(ab);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return "";
}
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0x7f;
  return out;
}
function decodeAscii(b: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = b[off + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/* ── Daftar field (read-only + edit) ── */
const EXIF_IFD0_LABELS: Record<number, string> = {
  0x010f: "Make (kamera)", 0x0110: "Model", 0x0131: "Software",
  0x0132: "Tanggal (EXIF)", 0x013b: "Artist", 0x010e: "Deskripsi", 0x8298: "Copyright",
};
const EXIF_SUB_LABELS: Record<number, string> = {
  0x9003: "Tanggal asli foto", 0xa434: "Lensa",
};

interface TiffEntry { tag: number; type: number; count: number; valueBytes: Uint8Array }
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

function parseTiffIfd(b: Uint8Array, tiffStart: number, ifdOff: number, le: boolean): TiffEntry[] {
  const out: TiffEntry[] = [];
  const u16 = (o: number) => le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
  const u32 = (o: number) => le
    ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0
    : ((b[o] * 0x1000000) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const base = tiffStart + ifdOff;
  if (base + 2 > b.length) return out;
  const n = u16(base);
  for (let i = 0; i < n; i++) {
    const e = base + 2 + i * 12;
    if (e + 12 > b.length) break;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const size = (TYPE_SIZE[type] || 1) * count;
    let valueBytes: Uint8Array;
    if (size <= 4) valueBytes = b.slice(e + 8, e + 8 + size);
    else {
      const vo = tiffStart + u32(e + 8);
      valueBytes = b.slice(vo, Math.min(b.length, vo + size));
    }
    out.push({ tag, type, count, valueBytes });
  }
  return out;
}

function parseJpegFields(b: Uint8Array, name: string): MetaField[] {
  const fields: MetaField[] = [];
  let pos = 2;
  while (pos + 4 <= b.length) {
    while (pos + 1 < b.length && b[pos] === 0xff && b[pos + 1] === 0xff) pos++;
    if (b[pos] !== 0xff) break;
    const marker = b[pos + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    const len = (b[pos + 2] << 8) | b[pos + 3];
    if (len < 2 || pos + 2 + len > b.length) break;
    const data = pos + 4, segLen = len - 2;
    if (marker === 0xe1 && decodeAscii(b, data, 6) === "Exif") {
      const tiffStart = data + 6;
      const le = b[tiffStart] === 0x49 && b[tiffStart + 1] === 0x49;
      const u32 = (o: number) => le
        ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0
        : ((b[o] * 0x1000000) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
      const ifd0Off = u32(tiffStart + 4);
      const ifd0 = parseTiffIfd(b, tiffStart, ifd0Off, le);
      let exifPtr = -1, gpsPtr = -1;
      for (const e of ifd0) {
        if (e.tag === 0x8769) exifPtr = u32(tiffStart + ifd0Off + 2 + ifd0.indexOf(e) * 12 + 8);
        else if (e.tag === 0x8825) gpsPtr = u32(tiffStart + ifd0Off + 2 + ifd0.indexOf(e) * 12 + 8);
      }
      // GPS pointer — cari offset pointer dengan cara yang benar:
      // (di atas indexOf bisa salah kalau ada entri duplikat; hitung ulang)
      {
        const u16 = (o: number) => le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
        const base = tiffStart + ifd0Off;
        const n = u16(base);
        for (let i = 0; i < n; i++) {
          const e = base + 2 + i * 12;
          const tag = u16(e);
          if (tag === 0x8769) exifPtr = u32(e + 8);
          else if (tag === 0x8825) gpsPtr = u32(e + 8);
        }
      }
      for (const e of ifd0) {
        if (e.type !== 2) continue;
        const label = EXIF_IFD0_LABELS[e.tag];
        if (!label) continue;
        const v = decodeAscii(e.valueBytes, 0, e.valueBytes.length);
        if (v) fields.push({ id: "exif:0x" + e.tag.toString(16), group: "EXIF", label, value: v, editable: true, deletable: true, kind: "exif-ascii", tag: e.tag, ifd: "ifd0" });
      }
      if (gpsPtr >= 0) {
        const gpsEntries = parseTiffIfd(b, tiffStart, gpsPtr, le);
        let coord = "koordinat lokasi tersimpan di file";
        const rat = (en: TiffEntry, idx: number): number => {
          const o = idx * 8;
          const num = en.valueBytes[o] | (en.valueBytes[o + 1] << 8) | (en.valueBytes[o + 2] << 16) | (en.valueBytes[o + 3] * 0x1000000);
          const den = en.valueBytes[o + 4] | (en.valueBytes[o + 5] << 8) | (en.valueBytes[o + 6] << 16) | (en.valueBytes[o + 7] * 0x1000000);
          return den === 0 ? 0 : num / den;
        };
        let lat: number | null = null, lon: number | null = null, latR = "N", lonR = "E";
        for (const en of gpsEntries) {
          if (en.tag === 0x0001) latR = decodeAscii(en.valueBytes, 0, 2) || "N";
          else if (en.tag === 0x0003) lonR = decodeAscii(en.valueBytes, 0, 2) || "E";
          else if (en.tag === 0x0002) lat = rat(en, 0) + rat(en, 1) / 60 + rat(en, 2) / 3600;
          else if (en.tag === 0x0004) lon = rat(en, 0) + rat(en, 1) / 60 + rat(en, 2) / 3600;
        }
        if (lat !== null && lon !== null) coord = (latR === "S" ? -lat : lat).toFixed(6) + ", " + (lonR === "W" ? -lon : lon).toFixed(6);
        fields.push({ id: "gps", group: "GPS", label: "GPS (lokasi)", value: coord, editable: false, deletable: true, kind: "exif-gps", tag: 0x8825, ifd: "ifd0" });
      }
      if (exifPtr >= 0) {
        const sub = parseTiffIfd(b, tiffStart, exifPtr, le);
        for (const e of sub) {
          if (e.type !== 2) continue;
          const label = EXIF_SUB_LABELS[e.tag];
          if (!label) continue;
          const v = decodeAscii(e.valueBytes, 0, e.valueBytes.length);
          if (v) fields.push({ id: "exif:0x" + e.tag.toString(16), group: "EXIF", label, value: v, editable: true, deletable: true, kind: "exif-ascii", tag: e.tag, ifd: "exif" });
        }
      }
    } else if (marker === 0xe1 && decodeAscii(b, data, 29).startsWith("http://ns.adobe.com/xap/1.0/")) {
      fields.push({ id: "seg:xmp", group: "XMP / IPTC", label: "XMP", value: "metadata Adobe XMP", editable: false, deletable: true, kind: "jpeg-seg", seg: "xmp" });
    } else if (marker === 0xed) {
      fields.push({ id: "seg:iptc", group: "XMP / IPTC", label: "IPTC / Photoshop", value: "segmen APP13", editable: false, deletable: true, kind: "jpeg-seg", seg: "iptc" });
    } else if (marker === 0xfe) {
      const v = decodeAscii(b, data, Math.min(segLen, 300));
      fields.push({ id: "seg:com", group: "Komentar", label: "Komentar (COM)", value: v, editable: true, deletable: true, kind: "jpeg-com", seg: "com" });
    }
    pos += 2 + len;
  }
  void name;
  return fields;
}

function parsePngFields(b: Uint8Array): MetaField[] {
  const fields: MetaField[] = [];
  let pos = 8;
  let textIdx = 0, exifIdx = 0, timeIdx = 0, iccpIdx = 0;
  while (pos + 8 <= b.length) {
    const len = (b[pos] * 0x1000000) + (b[pos + 1] << 16) + (b[pos + 2] << 8) + b[pos + 3];
    if (len < 0 || pos + 12 + len > b.length) break;
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    const data = pos + 8;
    if (type === "tEXt" || type === "iTXt") {
      let nul = -1;
      for (let i = 0; i < len; i++) { if (b[data + i] === 0) { nul = i; break; } }
      const keyword = nul >= 0 ? decodeAscii(b, data, nul) : "";
      let value = "";
      if (type === "tEXt") value = decodeAscii(b, data + (nul + 1), len - (nul + 1));
      else {
        // iTXt: keyword NUL, compression flag (1), method (1), language NUL, translated NUL, text
        let p = nul + 3;
        while (p < len && b[data + p] !== 0) p++;
        p++;
        while (p < len && b[data + p] !== 0) p++;
        p++;
        value = decodeAscii(b, data + p, len - p);
      }
      fields.push({ id: "png:" + type + ":" + textIdx, group: "PNG text", label: "PNG text: " + (keyword || "(tanpa keyword)"), value, editable: true, deletable: true, kind: "png-chunk", chunkType: type, chunkIndex: textIdx, keyword });
      textIdx++;
    } else if (type === "eXIf") {
      fields.push({ id: "png:eXIf:" + exifIdx, group: "EXIF", label: "EXIF (chunk eXIf)", value: "metadata EXIF di dalam PNG", editable: false, deletable: true, kind: "png-chunk", chunkType: "eXIf", chunkIndex: exifIdx });
      exifIdx++;
    } else if (type === "tIME") {
      fields.push({ id: "png:tIME:" + timeIdx, group: "Waktu", label: "Waktu pembuatan (PNG)", value: "chunk tIME tersimpan di file", editable: false, deletable: true, kind: "png-chunk", chunkType: "tIME", chunkIndex: timeIdx });
      timeIdx++;
    } else if (type === "iCCP") {
      fields.push({ id: "png:iCCP:" + iccpIdx, group: "XMP / IPTC", label: "Profil warna (ICC)", value: "chunk iCCP — deskripsinya bisa berisi teks", editable: false, deletable: true, kind: "png-chunk", chunkType: "iCCP", chunkIndex: iccpIdx });
      iccpIdx++;
    }
    if (type === "IEND") break;
    pos += 12 + len;
  }
  return fields;
}

function parseWebpFields(b: Uint8Array): MetaField[] {
  const fields: MetaField[] = [];
  let pos = 12;
  let exifIdx = 0, xmpIdx = 0, iccpIdx = 0;
  while (pos + 8 <= b.length) {
    const type = String.fromCharCode(b[pos], b[pos + 1], b[pos + 2], b[pos + 3]);
    const len = b[pos + 4] | (b[pos + 5] << 8) | (b[pos + 6] << 16) | (b[pos + 7] << 24);
    if (pos + 8 + len > b.length) break;
    if (type === "EXIF") { fields.push({ id: "webp:EXIF:" + exifIdx, group: "EXIF", label: "EXIF (chunk WebP)", value: "metadata EXIF di dalam WebP", editable: false, deletable: true, kind: "webp-chunk", chunkType: "EXIF", chunkIndex: exifIdx }); exifIdx++; }
    else if (type === "XMP ") { fields.push({ id: "webp:XMP:" + xmpIdx, group: "XMP / IPTC", label: "XMP", value: "metadata Adobe XMP", editable: false, deletable: true, kind: "webp-chunk", chunkType: "XMP ", chunkIndex: xmpIdx }); xmpIdx++; }
    else if (type === "ICCP") { fields.push({ id: "webp:ICCP:" + iccpIdx, group: "XMP / IPTC", label: "Profil warna (ICC)", value: "chunk ICCP", editable: false, deletable: true, kind: "webp-chunk", chunkType: "ICCP", chunkIndex: iccpIdx }); iccpIdx++; }
    pos += 8 + len + (len % 2);
  }
  return fields;
}

export async function listEditableFields(blob: Blob, name: string, lastModified: number): Promise<MetaField[]> {
  const fields: MetaField[] = [
    { id: "file:name", group: "File", label: "Nama file", value: name, editable: false, deletable: false, kind: "file" },
    { id: "file:type", group: "File", label: "Tipe", value: blob.type || "—", editable: false, deletable: false, kind: "file" },
    { id: "file:size", group: "File", label: "Ukuran", value: formatBytesLocal(blob.size), editable: false, deletable: false, kind: "file" },
    { id: "file:mtime", group: "File", label: "Terakhir diubah", value: new Date(lastModified).toLocaleString("id-ID"), editable: false, deletable: false, kind: "file" },
  ];
  const ab = await blob.arrayBuffer();
  const b = new Uint8Array(ab);
  const kind = sniffKind(ab);
  if (kind === "image/jpeg") fields.push(...parseJpegFields(b, name));
  else if (kind === "image/png") fields.push(...parsePngFields(b));
  else if (kind === "image/webp") fields.push(...parseWebpFields(b));
  return fields;
}
function formatBytesLocal(n: number): string {
  if (n === 0) return "0 B";
  const k = 1024, s = ["B", "KB", "MB", "GB"];
  const i = Math.min(s.length - 1, Math.floor(Math.log(n) / Math.log(k)));
  return (n / Math.pow(k, i)).toFixed(i ? 1 : 0) + " " + s[i];
}

/* ── Tulis: rebuild TIFF (JPEG EXIF) ──
   Entri yang dihapus dibuang; entri yang diedit in-place (muat) nilainya
   diganti; semua offset nilai dihitung ulang dari layout baru — jadi
   tidak ada offset basi. Entri yang tidak dikenal dipertahankan apa
   adanya (termasuk Orientasi). */
interface RebuildEntry { tag: number; type: number; count: number; valueBytes: Uint8Array }
function rebuildTiff(
  b: Uint8Array, tiffStart: number, le: boolean,
  exifEdits: Map<string, FieldEdit>, fields: MetaField[],
): { tiff: Uint8Array; skipped: string[] } {
  const skipped: string[] = [];
  const u16 = (o: number) => le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
  const u32 = (o: number) => le
    ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0
    : ((b[o] * 0x1000000) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const ifd0Off = u32(tiffStart + 4);
  const ifd0 = parseTiffIfd(b, tiffStart, ifd0Off, le);
  const base0 = tiffStart + ifd0Off;
  const n0 = u16(base0);
  let exifPtr = -1, gpsPtr = -1;
  for (let i = 0; i < n0; i++) {
    const e = base0 + 2 + i * 12;
    const tag = u16(e);
    if (tag === 0x8769) exifPtr = u32(e + 8);
    else if (tag === 0x8825) gpsPtr = u32(e + 8);
  }
  const sub = exifPtr >= 0 ? parseTiffIfd(b, tiffStart, exifPtr, le) : [];
  const gps = gpsPtr >= 0 ? parseTiffIfd(b, tiffStart, gpsPtr, le) : [];

  const fieldByTag = (ifd: string, tag: number) => fields.find((f) => f.kind === "exif-ascii" && f.ifd === ifd && f.tag === tag);
  function processEntries(entries: TiffEntry[], ifd: "ifd0" | "exif"): RebuildEntry[] {
    const out: RebuildEntry[] = [];
    for (const e of entries) {
      const f = fieldByTag(ifd, e.tag);
      const edit = f ? exifEdits.get(f.id) : undefined;
      if (edit?.action === "delete") continue;
      if (edit?.action === "edit" && e.type === 2) {
        const newVal = (edit.value ?? "").trim();
        if (newVal === "") continue; // nilai kosong = hapus field
        // Harus muat dalam alokasi lama (count termasuk NUL).
        if (newVal.length + 1 > e.count) { skipped.push(f?.label ?? ("tag 0x" + e.tag.toString(16))); continue; }
        const bytes = new Uint8Array(e.count);
        const nb = asciiBytes(newVal);
        bytes.set(nb, 0);
        out.push({ tag: e.tag, type: e.type, count: e.count, valueBytes: bytes });
        continue;
      }
      out.push({ tag: e.tag, type: e.type, count: e.count, valueBytes: e.valueBytes });
    }
    return out;
  }
  const gpsDeleted = exifEdits.get("gps")?.action === "delete";
  const newIfd0All = processEntries(ifd0, "ifd0").filter((e) => e.tag !== 0x8769 && e.tag !== 0x8825);
  const newSub = processEntries(sub, "exif");
  const keepExif = newSub.length > 0 && exifPtr >= 0;
  const keepGps = !gpsDeleted && gpsPtr >= 0 && gps.length > 0;

  // Layout baru: header(8) + IFD0 + nilai IFD0 + Exif IFD + nilainya + GPS IFD + nilainya.
  const extSize = (list: RebuildEntry[]) => list.reduce((s, e) => s + ((TYPE_SIZE[e.type] || 1) * e.count > 4 ? (TYPE_SIZE[e.type] || 1) * e.count : 0), 0);
  const ifd0Size = 2 + (newIfd0All.length + (keepExif ? 1 : 0) + (keepGps ? 1 : 0)) * 12 + 4;
  const val0Pos = 8 + ifd0Size;
  const exifPos = val0Pos + extSize(newIfd0All);
  const exifSize = keepExif ? 2 + newSub.length * 12 + 4 : 0;
  const valExifPos = exifPos + exifSize;
  const gpsPos = valExifPos + (keepExif ? extSize(newSub) : 0);
  const gpsSize = keepGps ? 2 + gps.length * 12 + 4 : 0;
  const total = gpsPos + gpsSize + (keepGps ? extSize(gps) : 0);
  const out = new Uint8Array(total);
  const w16 = (o: number, v: number) => { if (le) { out[o] = v & 0xff; out[o + 1] = (v >> 8) & 0xff; } else { out[o] = (v >> 8) & 0xff; out[o + 1] = v & 0xff; } };
  const w32 = (o: number, v: number) => {
    if (le) { out[o] = v & 0xff; out[o + 1] = (v >> 8) & 0xff; out[o + 2] = (v >> 16) & 0xff; out[o + 3] = (v >> 24) & 0xff; }
    else { out[o] = (v >> 24) & 0xff; out[o + 1] = (v >> 16) & 0xff; out[o + 2] = (v >> 8) & 0xff; out[o + 3] = v & 0xff; }
  };
  // Header TIFF (endian + 42 + offset IFD0 = 8)
  out[0] = le ? 0x49 : 0x4d; out[1] = le ? 0x49 : 0x4d;
  w16(2, 42); w32(4, 8);
  function writeIfd(ifdPos: number, valPos: number, entries: RebuildEntry[], extraPointers: { tag: number; value: number }[]): number {
    // entries sudah termasuk pointer? Tidak — pointer ditulis sebagai entri tambahan di akhir.
    const all = [...entries];
    for (const p of extraPointers) all.push({ tag: p.tag, type: 4, count: 1, valueBytes: new Uint8Array(4) });
    all.sort((a, c) => a.tag - c.tag);
    w16(ifdPos, all.length);
    let vCursor = valPos;
    all.forEach((e, i) => {
      const eo = ifdPos + 2 + i * 12;
      w16(eo, e.tag); w16(eo + 2, e.type); w32(eo + 4, e.count);
      const size = (TYPE_SIZE[e.type] || 1) * e.count;
      const ptr = extraPointers.find((p) => p.tag === e.tag);
      if (ptr) { w32(eo + 8, ptr.value); return; }
      if (size <= 4) { out.set(e.valueBytes.slice(0, size), eo + 8); }
      else { w32(eo + 8, vCursor); out.set(e.valueBytes.slice(0, size), vCursor); vCursor += size; }
    });
    w32(ifdPos + 2 + all.length * 12, 0); // next IFD = 0
    return vCursor;
  }
  const end0 = writeIfd(8, val0Pos, newIfd0All, [
    ...(keepExif ? [{ tag: 0x8769, value: exifPos }] : []),
    ...(keepGps ? [{ tag: 0x8825, value: gpsPos }] : []),
  ]);
  void end0;
  if (keepExif) writeIfd(exifPos, valExifPos, newSub, []);
  if (keepGps) writeIfd(gpsPos, gpsPos + gpsSize, gps, []);
  return { tiff: out, skipped };
}

/* ── Tulis perubahan ke blob ── */
export async function applyFieldEdits(blob: Blob, edits: FieldEdit[], fields: MetaField[]): Promise<{ blob: Blob; skipped: string[] }> {
  const ab = await blob.arrayBuffer();
  const b = new Uint8Array(ab);
  const kind = sniffKind(ab);
  const skipped: string[] = [];
  const byId = new Map(edits.map((e) => [e.id, e]));
  if (kind === "image/jpeg") {
    // Segmen JPEG: jalanin, kumpulkan segmen baru.
    const out: Uint8Array[] = [b.slice(0, 2)];
    let pos = 2;
    // Guard pos+2 (bukan pos+4): EOI di ujung file cuma 2 byte — dengan
    // guard pos+4, EOI terakhir tidak pernah disalin (bug: output tanpa
    // EOI -> stripJpegMeta melempar "JPEG rusak" -> scrub gagal).
    while (pos + 2 <= b.length) {
      while (pos + 1 < b.length && b[pos] === 0xff && b[pos + 1] === 0xff) pos++;
      if (b[pos] !== 0xff) break;
      const marker = b[pos + 1];
      if (marker === 0xd9) { out.push(b.slice(pos, pos + 2)); break; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(b.slice(pos, pos + 2)); pos += 2; continue; }
      if (pos + 4 > b.length) break; // segmen tak lengkap — buang sisa
      const len = (b[pos + 2] << 8) | b[pos + 3];
      if (len < 2 || pos + 2 + len > b.length) break;
      const data = pos + 4, segLen = len - 2;
      if (marker === 0xda) {
        // SOS: salin header + scan data sampai EOI pertama (seperti stripJpegMeta).
        let eoi = -1;
        for (let j = pos + 2 + len; j + 1 < b.length; j++) { if (b[j] === 0xff && b[j + 1] === 0xd9) { eoi = j; break; } }
        out.push(eoi === -1 ? b.slice(pos) : b.slice(pos, eoi + 2));
        pos = b.length;
        break;
      }
      const isExif = marker === 0xe1 && decodeAscii(b, data, 6) === "Exif";
      const isXmp = marker === 0xe1 && decodeAscii(b, data, 29).startsWith("http://ns.adobe.com/xap/1.0/");
      const isIptc = marker === 0xed;
      const isCom = marker === 0xfe;
      if (isExif) {
        const hasExifEdits = edits.some((e) => {
          const f = fields.find((x) => x.id === e.id);
          return f && (f.kind === "exif-ascii" || f.kind === "exif-gps");
        });
        if (!hasExifEdits) { out.push(b.slice(pos, pos + 2 + len)); }
        else {
          const tiffStart = data + 6;
          const le = b[tiffStart] === 0x49 && b[tiffStart + 1] === 0x49;
          const exifEdits = new Map([...byId.entries()].filter(([id]) => {
            const f = fields.find((x) => x.id === id);
            return f && (f.kind === "exif-ascii" || f.kind === "exif-gps");
          }));
          const { tiff, skipped: sk } = rebuildTiff(b, tiffStart, le, exifEdits, fields);
          skipped.push(...sk);
          // Segmen APP1 baru: FF E1 + len + "Exif\0\0" + TIFF.
          const segLenNew = 2 + 6 + tiff.length;
          const seg = new Uint8Array(2 + 2 + 6 + tiff.length);
          seg[0] = 0xff; seg[1] = 0xe1;
          seg[2] = (segLenNew >> 8) & 0xff; seg[3] = segLenNew & 0xff;
          seg.set(asciiBytes("Exif\0\0"), 4);
          seg.set(tiff, 10);
          out.push(seg);
        }
      } else if (isXmp && byId.get("seg:xmp")?.action === "delete") {
        // buang segmen
      } else if (isIptc && byId.get("seg:iptc")?.action === "delete") {
        // buang segmen
      } else if (isCom) {
        const edit = byId.get("seg:com");
        if (edit?.action === "delete") { /* buang */ }
        else if (edit?.action === "edit") {
          const newVal = (edit.value ?? "").trim();
          if (newVal === "") { /* nilai kosong = hapus */ }
          else {
            const vb = asciiBytes(newVal);
            const segLenNew = 2 + vb.length;
            const seg = new Uint8Array(2 + 2 + vb.length);
            seg[0] = 0xff; seg[1] = 0xfe;
            seg[2] = (segLenNew >> 8) & 0xff; seg[3] = segLenNew & 0xff;
            seg.set(vb, 4);
            out.push(seg);
          }
        } else out.push(b.slice(pos, pos + 2 + len));
      } else {
        out.push(b.slice(pos, pos + 2 + len));
      }
      pos += 2 + len;
    }
    const total = out.reduce((s, c) => s + c.length, 0);
    const res = new Uint8Array(total);
    let off = 0;
    out.forEach((c) => { res.set(c, off); off += c.length; });
    return { blob: new Blob([res], { type: "image/jpeg" }), skipped };
  }
  if (kind === "image/png") {
    const out: Uint8Array[] = [b.slice(0, 8)];
    let pos = 8;
    const seenText = new Map<string, number>();
    const seenChunk = new Map<string, number>();
    while (pos + 8 <= b.length) {
      const len = (b[pos] * 0x1000000) + (b[pos + 1] << 16) + (b[pos + 2] << 8) + b[pos + 3];
      if (len < 0 || pos + 12 + len > b.length) break;
      const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
      const data = pos + 8;
      const total = 12 + len;
      let drop = false, replace: Uint8Array | null = null;
      if (type === "tEXt" || type === "iTXt") {
        const idx = seenText.get(type) ?? 0;
        seenText.set(type, idx + 1);
        const f = fields.find((x) => x.kind === "png-chunk" && x.chunkType === type && x.chunkIndex === idx);
        const edit = f ? byId.get(f.id) : undefined;
        if (edit?.action === "delete") drop = true;
        else if (edit?.action === "edit") {
          const newVal = (edit.value ?? "").trim();
          if (newVal === "") drop = true;
          else {
            const kw = asciiBytes(f?.keyword ?? "");
            let payload: Uint8Array;
            if (type === "tEXt") {
              payload = new Uint8Array(kw.length + 1 + asciiBytes(newVal).length);
              payload.set(kw, 0); payload[kw.length] = 0; payload.set(asciiBytes(newVal), kw.length + 1);
            } else {
              // iTXt: keyword NUL + flag 0 + method 0 + lang NUL + translated NUL + text
              const vb = asciiBytes(newVal);
              payload = new Uint8Array(kw.length + 1 + 2 + 1 + 1 + vb.length);
              payload.set(kw, 0); payload[kw.length] = 0;
              payload[kw.length + 3] = 0; payload[kw.length + 4] = 0;
              payload.set(vb, kw.length + 5);
            }
            const chunk = new Uint8Array(12 + payload.length);
            chunk[0] = (payload.length >>> 24) & 0xff; chunk[1] = (payload.length >>> 16) & 0xff; chunk[2] = (payload.length >>> 8) & 0xff; chunk[3] = payload.length & 0xff;
            chunk.set(asciiBytes(type), 4);
            chunk.set(payload, 8);
            const crcInput = new Uint8Array(4 + payload.length);
            crcInput.set(asciiBytes(type), 0); crcInput.set(payload, 4);
            const crc = crc32(crcInput);
            chunk[8 + payload.length] = (crc >>> 24) & 0xff; chunk[9 + payload.length] = (crc >>> 16) & 0xff; chunk[10 + payload.length] = (crc >>> 8) & 0xff; chunk[11 + payload.length] = crc & 0xff;
            replace = chunk;
          }
        }
      } else if (type === "eXIf" || type === "tIME" || type === "iCCP") {
        const idx = seenChunk.get(type) ?? 0;
        seenChunk.set(type, idx + 1);
        const f = fields.find((x) => x.kind === "png-chunk" && x.chunkType === type && x.chunkIndex === idx);
        if (f && byId.get(f.id)?.action === "delete") drop = true;
      }
      if (!drop) out.push(replace ?? b.slice(pos, pos + total));
      if (type === "IEND") break;
      pos += total;
    }
    const totalLen = out.reduce((s, c) => s + c.length, 0);
    const res = new Uint8Array(totalLen);
    let off = 0;
    out.forEach((c) => { res.set(c, off); off += c.length; });
    return { blob: new Blob([res], { type: "image/png" }), skipped };
  }
  if (kind === "image/webp") {
    const out: Uint8Array[] = [b.slice(0, 12)];
    let pos = 12;
    const seen = new Map<string, number>();
    while (pos + 8 <= b.length) {
      const type = String.fromCharCode(b[pos], b[pos + 1], b[pos + 2], b[pos + 3]);
      const len = b[pos + 4] | (b[pos + 5] << 8) | (b[pos + 6] << 16) | (b[pos + 7] << 24);
      if (pos + 8 + len > b.length) break;
      const total = 8 + len + (len % 2);
      let drop = false;
      if (type === "EXIF" || type === "XMP " || type === "ICCP") {
        const idx = seen.get(type) ?? 0;
        seen.set(type, idx + 1);
        const f = fields.find((x) => x.kind === "webp-chunk" && x.chunkType === type && x.chunkIndex === idx);
        if (f && byId.get(f.id)?.action === "delete") drop = true;
      }
      if (!drop) out.push(b.slice(pos, pos + total));
      pos += total;
    }
    const bodyLen = out.reduce((s, c) => s + c.length, 0) - 8; // tanpa "RIFF"+size (8 byte pertama)
    const res = new Uint8Array(8 + bodyLen + 4);
    // Header RIFF: "RIFF" + size + "WEBP" sudah di out[0] (12 byte: RIFF+size+WEBP).
    // Tulis ulang size di out[0].
    const first = out[0].slice();
    const riffSize = 4 + out.slice(1).reduce((s, c) => s + c.length, 0);
    first[4] = riffSize & 0xff; first[5] = (riffSize >> 8) & 0xff; first[6] = (riffSize >> 16) & 0xff; first[7] = (riffSize >> 24) & 0xff;
    let off = 0;
    res.set(first, 0); off += 12;
    out.slice(1).forEach((c) => { res.set(c, off); off += c.length; });
    return { blob: new Blob([res.slice(0, off)], { type: "image/webp" }), skipped };
  }
  // Format lain (AVIF dsb.): tidak ada yang bisa ditulis byte-level.
  return { blob, skipped: edits.map((e) => (fields.find((f) => f.id === e.id)?.label ?? e.id)) };
}

/* ── Panel ── */
interface MetaState {
  container: HTMLElement;
  name: string;
  blob: Blob;
  type: string;
  lastModified: number;
  fields: MetaField[];
  traces: Trace[];
  fileTrace: Trace | null;
  draft: Map<string, FieldEdit>;
  hooks: MetaHooks;
  saving: boolean;
}
let cur: MetaState | null = null;

function setStatus(msg: string): void {
  const el = cur?.container.querySelector("#metaStatus");
  if (el) el.textContent = msg;
}

function traceRowsHtml(traces: Trace[], fileTrace: Trace | null): string {
  const rows = traces.map((t) =>
    '<div class="jejak-row"><span class="jejak-ic" aria-hidden="true">!</span><div class="min-w-0"><b>' + esc(t.label) + '</b><span>' + esc(t.detail) + '</span></div></div>').join("");
  const fileRow = fileTrace
    ? '<div class="jejak-row jejak-file"><span class="jejak-ic" aria-hidden="true">i</span><div class="min-w-0"><b>' + esc(fileTrace.label) + '</b><span>' + esc(fileTrace.detail) + '</span></div></div>'
    : "";
  return rows + fileRow;
}

function renderPanel(): void {
  if (!cur) return;
  const st = cur;
  const groups: string[] = [];
  st.fields.forEach((f) => { if (!groups.includes(f.group)) groups.push(f.group); });
  const fieldsHtml = groups.map((g) => {
    const rows = st.fields.filter((f) => f.group === g).map((f) => {
      const draft = st.draft.get(f.id);
      const deleted = draft?.action === "delete";
      const val = draft?.action === "edit" ? (draft.value ?? "") : f.value;
      const shown = f.value.length > 140 ? f.value.slice(0, 140) + "…" : f.value;
      const valueHtml = f.editable
        ? '<input type="text" class="meta-input" data-field="' + esc(f.id) + '" value="' + esc(val) + '" aria-label="Ubah ' + esc(f.label) + '"' + (deleted ? " disabled" : "") + '>'
        : '<span class="meta-value">' + esc(shown) + '</span>';
      const delBtn = f.deletable
        ? '<button type="button" class="meta-del" data-del="' + esc(f.id) + '" aria-label="' + (deleted ? "Urungkan hapus field " : "Hapus field ") + esc(f.label) + '" title="' + (deleted ? "Urungkan hapus" : "Hapus field") + '">' + (deleted ? "↩" : "🗑") + '</button>'
        : "";
      return '<div class="meta-row' + (deleted ? " is-deleted" : "") + '"><label class="meta-label">' + esc(f.label) + (deleted ? ' <span class="meta-will-del">— akan dihapus</span>' : "") + '</label>' + valueHtml + delBtn + '</div>';
    }).join("");
    return '<div class="meta-group"><h4 class="meta-group-title">' + esc(g) + '</h4>' + rows + '</div>';
  }).join("");
  const tracesHtml = st.traces.length
    ? traceRowsHtml(st.traces, st.fileTrace) +
      '<button type="button" id="metaScrub" class="erase-btn primary meta-scrub">Hapus jejak</button>' +
      '<p class="meta-note">Menghapus EXIF, GPS, IPTC, XMP, teks PNG &amp; profil ICC dari file ini. Nama file tidak diubah.</p>'
    : '<p class="meta-clean">Tidak ada jejak di dalam file — sudah bersih.' + (st.fileTrace ? " " + esc(st.fileTrace.detail) + "." : "") + '</p>';
  st.container.innerHTML =
    '<div class="meta-panel">' +
    '<div class="meta-sec"><h3 class="meta-sec-title">Jejak privasi</h3>' + tracesHtml + '</div>' +
    '<div class="meta-sec"><h3 class="meta-sec-title">Semua metadata</h3>' + fieldsHtml + '</div>' +
    '<div class="meta-actions">' +
    '<button type="button" id="metaApply" class="erase-btn primary"' + (st.draft.size === 0 || st.saving ? " disabled" : "") + '>Terapkan perubahan</button>' +
    '<button type="button" id="metaReset" class="erase-btn"' + (st.draft.size === 0 || st.saving ? " disabled" : "") + '>Urungkan perubahan</button>' +
    '<p class="meta-note">Perubahan baru tersimpan sebagai versi Metadata setelah diterapkan — file aslimu tidak diubah.</p>' +
    '<p id="metaStatus" class="meta-status" role="status"></p>' +
    '</div></div>';
  syncApplyState();
}

function syncApplyState(): void {
  if (!cur) return;
  const dirty = cur.draft.size > 0;
  const apply = cur.container.querySelector("#metaApply") as HTMLButtonElement | null;
  const reset = cur.container.querySelector("#metaReset") as HTMLButtonElement | null;
  if (apply) apply.disabled = !dirty || cur.saving;
  if (reset) reset.disabled = !dirty || cur.saving;
}

function markDirty(): void {
  syncApplyState();
}

export function isMetaDirty(): boolean {
  return !!cur && cur.draft.size > 0;
}

export function discardMetaDraft(): void {
  if (!cur) return;
  cur.draft.clear();
  renderPanel();
}

export async function applyMetaDraft(): Promise<boolean> {
  if (!cur) return true;
  const st = cur;
  if (st.draft.size === 0) return true;
  if (st.saving) return false;
  st.saving = true;
  setStatus("Lagi menerapkan…");
  syncApplyState();
  try {
    const edits = [...st.draft.values()];
    const { blob, skipped } = await applyFieldEdits(st.blob, edits, st.fields);
    const done = skipped.length
      ? "Sebagian diterapkan — dilewati (terlalu panjang, hapus saja): " + skipped.join(", ") + "."
      : "Metadata diubah";
    await st.hooks.onReplace(blob, done);
    // Re-render panel dari blob baru (re-scan, bukan klaim).
    await openMetaFor(st.container, { name: st.name, blob, type: blob.type || st.type, lastModified: st.lastModified }, st.hooks, true);
    setStatus(skipped.length
      ? "Perubahan diterapkan ✓ " + skipped.length + " field dilewati — nilainya lebih panjang dari aslinya, hapus field itu saja."
      : "Perubahan diterapkan ✓ Dicek ulang dari file baru.");
    return true;
  } catch (e) {
    const msg = String((e as Error).message || "Gagal").replace(/\.+$/, "");
    setStatus("Gagal menerapkan: " + msg + ". Draft kamu tetap ada — perbaiki lalu coba lagi.");
    st.hooks.onToast("Gagal menerapkan metadata: " + msg + ".");
    return false;
  } finally {
    if (cur) { cur.saving = false; syncApplyState(); }
  }
}

async function runScrub(): Promise<void> {
  if (!cur) return;
  const st = cur;
  if (st.saving) return;
  st.saving = true;
  setStatus("Lagi menghapus jejak…");
  try {
    const out = await st.hooks.onScrub(st.blob);
    const after = await scanTraces(out);
    if (after.length === 0) {
      await st.hooks.onReplace(out, "Jejak dihapus");
      await openMetaFor(st.container, { name: st.name, blob: out, type: out.type || st.type, lastModified: st.lastModified }, st.hooks, true);
      setStatus("Jejak dihapus ✓ Dicek ulang: 0 jejak tersisa di dalam file.");
    } else {
      setStatus("Masih ada " + after.length + " jejak: " + after.map((t) => t.label).join(", ") + ". Coba lagi.");
      st.hooks.onToast("Masih ada jejak tersisa. Coba lagi.");
    }
  } catch (e) {
    const msg = String((e as Error).message || "Gagal").replace(/\.+$/, "");
    setStatus("Gagal hapus jejak: " + msg + ". Coba lagi.");
    st.hooks.onToast("Gagal hapus jejak: " + msg + ".");
  } finally {
    if (cur) { cur.saving = false; syncApplyState(); }
  }
}

export async function openMetaFor(
  container: HTMLElement,
  source: { name: string; blob: Blob; type: string; lastModified: number },
  hooks: MetaHooks,
  force = false,
): Promise<void> {
  // Blob yang sama + panel sudah terbuka = jangan render ulang (draft
  // user akan hilang). Dipanggil ulang tiap autoRun — aman.
  if (!force && cur && cur.container === container && cur.blob === source.blob) return;
  const traces = await scanTraces(source.blob);
  const fileTrace = filenameTrace(source.name);
  const fields = await listEditableFields(source.blob, source.name, source.lastModified);
  cur = {
    container,
    name: source.name,
    blob: source.blob,
    type: source.type,
    lastModified: source.lastModified,
    fields,
    traces,
    fileTrace,
    draft: new Map(),
    hooks,
    saving: false,
  };
  renderPanel();
}

export function closeMetaPanel(): void {
  cur = null;
}

/* Delegasi event panel (satu listener per container, dipasang sekali). */
const wired = new WeakSet<HTMLElement>();
export function wireMetaPanel(container: HTMLElement): void {
  if (wired.has(container)) return;
  wired.add(container);
  container.addEventListener("input", (e) => {
    if (!cur) return;
    const input = (e.target as Element).closest("input[data-field]") as HTMLInputElement | null;
    if (!input) return;
    const f = cur.fields.find((x) => x.id === input.dataset.field);
    if (!f) return;
    const v = input.value;
    if (v === f.value) cur.draft.delete(f.id);
    else cur.draft.set(f.id, { id: f.id, action: "edit", value: v });
    markDirty();
  });
  container.addEventListener("click", (e) => {
    if (!cur) return;
    const del = (e.target as Element).closest("button[data-del]") as HTMLButtonElement | null;
    if (del) {
      const id = del.dataset.del as string;
      const f = cur.fields.find((x) => x.id === id);
      if (!f) return;
      if (cur.draft.get(id)?.action === "delete") cur.draft.delete(id);
      else cur.draft.set(id, { id, action: "delete" });
      renderPanel();
      return;
    }
    const t = e.target as Element;
    if (t.closest("#metaApply")) { void applyMetaDraft(); return; }
    if (t.closest("#metaReset")) { discardMetaDraft(); return; }
    if (t.closest("#metaScrub")) { void runScrub(); return; }
  });
}

/** Reusable delete-only metadata template. No edited field values or personal
 * metadata is stored by the application. Matching uses kind, group and label,
 * not unstable byte offsets from a different file. */
export interface DeletionRule { kind:string; group:string; label:string }
export function exportDeletionTemplate():DeletionRule[] {
  if(!cur)return [];
  return [...cur.draft.values()].filter(e=>e.action==="delete").map(e=>{
    const f=cur!.fields.find(x=>x.id===e.id);
    return f?{kind:f.kind,group:f.group,label:f.label}:null;
  }).filter((x):x is DeletionRule=>x!==null);
}
export function loadDeletionTemplate(rules:unknown):number {
  if(!cur||!Array.isArray(rules))return 0;
  let n=0;
  for(const r of rules.slice(0,120)){
    if(!r||typeof r!=="object"||typeof r.kind!=="string"||typeof r.label!=="string")continue;
    for(const f of cur.fields){
      if(f.deletable&&f.kind===r.kind&&f.group===r.group&&f.label===r.label) {
        cur.draft.set(f.id,{id:f.id,action:"delete"});
        n++;
      }
    }
  }
  if(n)renderPanel();
  return n;
}
