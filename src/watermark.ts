/* Hapus Watermark — deteksi otomatis + hapus pakai editor yang sama
   kayak Hapus Objek (src/erase.ts). Alur: deteksi cari tanda di pojok &
   tepi foto (mis. sparkle Gemini, badge "Made with AI"), tandain merah
   sebagai mask awal, user bisa nambah/kurangin pakai kuas, lalu hapus
   dengan mode yang sama: Instan (Telea, tanpa download) / Cepat AI
   (MI-GAN) / Terbaik (LaMa) — model tetap lazy-load, cuma diunduh pas
   mode AI dibuka (lihat src/erase.ts).

   Deteksi murni (tanpa DOM, tanpa model): di grid kecil (sisi panjang
   maks 480) cari piksel yang kontras kuat terhadap latar sekitarnya
   (beda vs blur lokal — kebal terhadap watermark semi-transparan yang
   di-blend ke foto) ATAU tepi yang tajam, lalu kelompokkan jadi gumpalan
   kecil di zona pojok/tepi. Foto biasa nggak ketemu apa-apa: langit/
   awan itu besar & lembut (beda vs blur kecil, tepi lembut), dan objek
   di tengah foto ada di luar zona. Mask awal selalu kelihatan & bisa
   diubah user — deteksi salah bukan bencana, cuma coretan awal. */

import { openEraser, type EraseSource, type EraseHooks } from "./erase";

/* ImageData di browser memenuhi bentuk ini secara struktural; di Node
   (buat tuning) cukup kirim { data, width, height } biasa. */
export interface ImgLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface WatermarkBox {
  x: number; y: number; w: number; h: number;
  where: string; // "pojok kanan bawah", "tepi bawah", ...
}

export interface WatermarkDetect {
  mask: Uint8Array<ArrayBuffer>; // resolusi kerja, 1 = watermark
  boxes: WatermarkBox[]; // koordinat resolusi kerja
  found: boolean;
  note: string;
}

const DET_MAX = 480; // sisi panjang maks grid deteksi
const BLUR_R = 8; // radius blur latar (px grid deteksi)
const DELTA_BRIGHT = 20; // terang vs latar sekitar
const L_BRIGHT_MIN = 130;
const DELTA_DARK = -20; // gelap vs latar sekitar (teks di badge terang)
const L_DARK_MAX = 120;
const EDGE_T = 24; // ambang Sobel (0-255, sudah /4)
const ZONE_CORNER = 0.26; // pojok: 26% lebar & tinggi dari tiap sisi
const ZONE_STRIP = 0.10; // strip atas/bawah: 10% tinggi, selebar foto
const MIN_AREA = 24; // px grid deteksi
const MAX_AREA_FRAC = 0.02; // gumpalan maks 2% luas foto
const MAX_BBOX_FRAC = 0.45; // bbox maks 45% sisi foto
const MIN_FILL = 0.20; // isi bbox minimal (cincin tepi tipis ~0.3, teks ~0.3)
const FILL_BBOX_AT = 0.30; // kalau sepadat ini, isi seluruh bbox (badge utuh)
const MIN_MEAN_DELTA = 24;
const MIN_EDGE_FRAC = 0.30; // alternatif: tepi padat + kontras sedang
const MIN_MEAN_DELTA_EDGY = 10;
const MERGE_GAP = 12; // px grid deteksi — huruf & pinggir badge nyambung
const MAX_BLOBS = 4;

/* ── Util grid ── */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* Luminansi (area-average) ke grid deteksi. */
function downscaleLuma(img: ImgLike, dw: number, dh: number): Float32Array {
  const { data, width: W, height: H } = img;
  const L = new Float32Array(dw * dh);
  const sx = W / dw, sy = H / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(H, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(W, Math.ceil((x + 1) * sx)));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * W + xx) * 4;
          sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          n++;
        }
      }
      L[y * dw + x] = sum / n;
    }
  }
  return L;
}

/* Box blur separable (sliding window, tepi diulang). */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const div = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / div;
      acc += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / div;
      acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

/* Magnitudo Sobel (0-255, sudah /4). */
function sobel(L: Float32Array, w: number, h: number): Float32Array {
  const E = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
      const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
      const m = Math.hypot(gx, gy) / 4;
      E[i] = m > 255 ? 255 : m;
    }
  }
  return E;
}

function inZone(x: number, y: number, dw: number, dh: number): boolean {
  const fx = x / dw, fy = y / dh;
  const corner = (fx < ZONE_CORNER || fx > 1 - ZONE_CORNER) && (fy < ZONE_CORNER || fy > 1 - ZONE_CORNER);
  const strip = fy < ZONE_STRIP || fy > 1 - ZONE_STRIP;
  return corner || strip;
}

function whereOf(cx: number, cy: number, w: number, h: number): string {
  const fx = cx / w, fy = cy / h;
  if (fx < 0.33 && fy > 0.67) return "pojok kiri bawah";
  if (fx > 0.67 && fy > 0.67) return "pojok kanan bawah";
  if (fx < 0.33 && fy < 0.33) return "pojok kiri atas";
  if (fx > 0.67 && fy < 0.33) return "pojok kanan atas";
  if (fy < 0.15) return "tepi atas";
  if (fy > 0.85) return "tepi bawah";
  if (fx < 0.15) return "tepi kiri";
  if (fx > 0.85) return "tepi kanan";
  return "tepi foto";
}

interface Comp {
  area: number;
  minX: number; maxX: number; minY: number; maxY: number;
  sumDelta: number; edge: number;
  pixels: number[]; // indeks grid (buat bangun mask)
}

export interface BlobStat {
  area: number; bw: number; bh: number; fill: number;
  meanDelta: number; edgeFrac: number; score: number;
  kept: boolean; reason: string;
}

/* Analisis grid -> daftar gumpalan (termasuk yang ditolak + alasannya).
   Dipakai detectWatermark dan, buat tuning, detectWatermarkDebug. */
interface KeptBlob { stat: BlobStat; pixels: number[] }
function analyzeGrid(img: ImgLike): { dw: number; dh: number; scale: number; blobs: BlobStat[]; kept: KeptBlob[] } {
  const W = img.width, H = img.height;
  const s = Math.min(1, DET_MAX / Math.max(W, H));
  const dw = Math.max(1, Math.round(W * s)), dh = Math.max(1, Math.round(H * s));
  const L = downscaleLuma(img, dw, dh);
  const B = boxBlur(L, dw, dh, BLUR_R);
  const E = sobel(L, dw, dh);

  // Kandidat: kontras kuat vs latar sekitar, atau tepi tajam — di zona saja.
  const cand = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const i = y * dw + x;
      if (!inZone(x, y, dw, dh)) continue;
      const d = L[i] - B[i];
      if ((d > DELTA_BRIGHT && L[i] > L_BRIGHT_MIN) || (d < DELTA_DARK && L[i] < L_DARK_MAX) || E[i] > EDGE_T) {
        cand[i] = 1;
      }
    }
  }
  // Dilasi 1 px: tepi anti-alias jadi 3 px — cincin tipis (sparkle)
  // tidak lolos saringan fill cuma karena tipis.
  const dil = new Uint8Array(cand);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      if (cand[y * dw + x]) continue;
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= dw || yy >= dh) continue;
          if (cand[yy * dw + xx]) { hit = true; break; }
        }
      }
      if (hit) dil[y * dw + x] = 1;
    }
  }

  // Komponen terhubung (8 arah).
  const seen = new Uint8Array(dw * dh);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let start = 0; start < dw * dh; start++) {
    if (!dil[start] || seen[start]) continue;
    const comp: Comp = { area: 0, minX: dw, maxX: -1, minY: dh, maxY: -1, sumDelta: 0, edge: 0, pixels: [] };
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      const px = p % dw, py = (p / dw) | 0;
      comp.pixels.push(p);
      comp.area++;
      if (px < comp.minX) comp.minX = px;
      if (px > comp.maxX) comp.maxX = px;
      if (py < comp.minY) comp.minY = py;
      if (py > comp.maxY) comp.maxY = py;
      comp.sumDelta += Math.abs(L[p] - B[p]);
      if (E[p] > EDGE_T) comp.edge++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = px + dx, yy = py + dy;
          if (xx < 0 || yy < 0 || xx >= dw || yy >= dh) continue;
          const q = yy * dw + xx;
          if (dil[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
    }
    comps.push(comp);
  }

  // Gabung komponen yang bbox-nya berdekatan (huruf-huruf satu badge,
  // pinggir badge & teksnya) — union-find atas jarak bbox.
  const parent = comps.map((_, i) => i);
  function find(a: number): number {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  }
  function bboxGap(a: Comp, b: Comp): number {
    const gx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
    const gy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
    return Math.max(gx, gy);
  }
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      if (bboxGap(comps[i], comps[j]) <= MERGE_GAP) {
        const ri = find(i), rj = find(j);
        if (ri !== rj) parent[ri] = rj;
      }
    }
  }
  const groups = new Map<number, Comp[]>();
  comps.forEach((c, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(c);
  });

  // Saring gumpalan: kecil, padat, kontras kuat — bukan langit/objek besar.
  // Keeper dibawa bersama pikselnya (buat mask), diurutkan skor, cap 4.
  const all: KeptBlob[] = [];
  for (const members of groups.values()) {
    let area = 0, minX = dw, maxX = -1, minY = dh, maxY = -1, sumDelta = 0, edge = 0;
    const pixels: number[] = [];
    for (const c of members) {
      area += c.area;
      if (c.minX < minX) minX = c.minX;
      if (c.maxX > maxX) maxX = c.maxX;
      if (c.minY < minY) minY = c.minY;
      if (c.maxY > maxY) maxY = c.maxY;
      sumDelta += c.sumDelta;
      edge += c.edge;
      pixels.push(...c.pixels);
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const fill = area / (bw * bh);
    const meanDelta = area ? sumDelta / area : 0;
    const edgeFrac = area ? edge / area : 0;
    const score = meanDelta * Math.sqrt(area);
    let reason = "";
    if (area < MIN_AREA) reason = "area<" + MIN_AREA;
    else if (area > MAX_AREA_FRAC * dw * dh) reason = "area>2%";
    else if (bw > MAX_BBOX_FRAC * dw || bh > MAX_BBOX_FRAC * dh) reason = "bbox>45%";
    else if (fill < MIN_FILL) reason = "fill<" + MIN_FILL;
    else if (!(meanDelta >= MIN_MEAN_DELTA || (edgeFrac >= MIN_EDGE_FRAC && meanDelta >= MIN_MEAN_DELTA_EDGY))) reason = "kontras lemah";
    const kept = !reason;
    all.push({
      stat: { area, bw, bh, fill: +fill.toFixed(2), meanDelta: +meanDelta.toFixed(1), edgeFrac: +edgeFrac.toFixed(2), score: +score.toFixed(0), kept, reason: kept ? "ok" : reason },
      pixels,
    });
  }
  const kept = all.filter((b) => b.stat.kept).sort((a, b) => b.stat.score - a.stat.score).slice(0, MAX_BLOBS);
  return { dw, dh, scale: s, blobs: all.map((b) => b.stat), kept };
}

/* Debug/tuning: statistik tiap gumpalan (kept + ditolak + alasan). */
export function detectWatermarkDebug(img: ImgLike): { dw: number; dh: number; blobs: BlobStat[] } {
  const a = analyzeGrid(img);
  return { dw: a.dw, dh: a.dh, blobs: a.blobs };
}

/**
 * Deteksi watermark di pojok/tepi. Mengembalikan mask di resolusi kerja
 * (sama seperti input) + kotak-kotaknya, atau null kalau tidak ketemu.
 */
export function detectWatermark(img: ImgLike): WatermarkDetect | null {
  const W = img.width, H = img.height;
  if (W < 32 || H < 32) return null;
  const a = analyzeGrid(img);
  if (!a.kept.length) return null;
  const { dw, dh, scale: s } = a;

  // Bangun mask di grid deteksi dari piksel keeper (isi bbox kalau
  // gumpalannya padat — badge utuh, bukan cuma hurufnya), dilasi 1,
  // lalu upscale ke resolusi kerja.
  const det = new Uint8Array(dw * dh);
  const boxes: WatermarkBox[] = [];
  for (const { stat, pixels } of a.kept) {
    let minX = dw, maxX = -1, minY = dh, maxY = -1;
    for (const p of pixels) {
      const px = p % dw, py = (p / dw) | 0;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    if (stat.fill >= FILL_BBOX_AT) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) det[y * dw + x] = 1;
      }
    } else {
      for (const p of pixels) det[p] = 1;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    boxes.push({
      x: Math.floor(minX / s), y: Math.floor(minY / s),
      w: Math.ceil((maxX - minX + 1) / s), h: Math.ceil((maxY - minY + 1) / s),
      where: whereOf(cx, cy, dw, dh),
    });
  }
  // Dilasi 1 px di grid deteksi (tangkap tepi anti-alias).
  const dil = new Uint8Array(det);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      if (det[y * dw + x]) continue;
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= dw || yy >= dh) continue;
          if (det[yy * dw + xx]) { hit = true; break; }
        }
      }
      if (hit) dil[y * dw + x] = 1;
    }
  }
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(dh - 1, Math.floor(y * s));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(dw - 1, Math.floor(x * s));
      mask[y * W + x] = dil[sy * dw + sx] ? 1 : 0;
    }
  }
  let masked = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) masked++;
  if (!masked) return null;

  const wheres = boxes.map((b) => b.where);
  const uniq = [...new Set(wheres)];
  const note = "Ketemu watermark di " + uniq.join(" & ") +
    " — udah ditandain merah. Coret buat nambah/kurangin, terus tekan Hapus.";
  return { mask, boxes, found: true, note };
}

/* Buka editor (yang sama kayak Hapus Objek) dengan mask awal hasil deteksi. */
export async function openWatermark(source: EraseSource, hooks: EraseHooks): Promise<void> {
  return openEraser(source, hooks, {
    title: "Hapus Watermark",
    initialMask: (img) => {
      const d = detectWatermark(img);
      return d ? { mask: d.mask, note: d.note } : null;
    },
    noMaskNote: "Nggak ketemu watermark otomatis di pojok/tepi — coret manual area watermark-nya, terus tekan Hapus.",
  });
}
