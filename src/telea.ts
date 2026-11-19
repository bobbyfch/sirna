/* Telea fast-marching inpainting (A. Telea, 2004) — murni TypeScript, tanpa
   dependensi, tanpa download. Dipakai mode Instan Hapus Objek: buat
   coretan kecil (teks, watermark, noda) hasilnya mulus. BATASAN JUJUR
   (terbukti Nov 2026, reproduksi skenario A): buat lubang BESAR di atas
   tekstur kontras tinggi (mis. rambut hitam-putih), isian bisa jadi
   pita garis hitam-putih (zebra) — BUKAN halus/blur. Penyebabnya
   ekstrapolasi gradien yang overshoot lalu ter-clamp 0/255, dirambatkan
   fast-marching ke tengah lubang. Mitigasinya: (1) kontribusi gradien
   dijepit ±32/kanal (lihat GRAD_CLAMP), (2) editor memperingatkan saat
   mask besar di mode Instan dan menyarankan Cepat AI / Terbaik.
   Buat lubang besar, mode AI (MI-GAN / LaMa) adalah jalan yang benar.
   Piksel di luar mask disalin apa adanya — byte-identical. */

/* Antrean prioritas min-heap atas indeks piksel, kunci = jarak T. Entri
   basi (piksel sudah terisi / T sudah mengecil) dilewati pas pop. */
class MinHeap {
  private keys: number[] = [];
  private idx: number[] = [];
  get size(): number { return this.keys.length; }
  push(key: number, i: number): void {
    const k = this.keys, ix = this.idx;
    k.push(key); ix.push(i);
    let c = k.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (k[p] <= k[c]) break;
      const tk = k[p]; k[p] = k[c]; k[c] = tk;
      const ti = ix[p]; ix[p] = ix[c]; ix[c] = ti;
      c = p;
    }
  }
  pop(): number {
    const k = this.keys, ix = this.idx;
    const top = ix[0];
    const lk = k.pop() as number, li = ix.pop() as number;
    if (k.length > 0) {
      k[0] = lk; ix[0] = li;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1, r = l + 1;
        let m = p;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === p) break;
        const tk = k[p]; k[p] = k[m]; k[m] = tk;
        const ti = ix[p]; ix[p] = ix[m]; ix[m] = ti;
        p = m;
      }
    }
    return top;
  }
}

/** Perlebar mask sejauh `r` piksel (biar sisa pinggiran objek ikut kehapus). */
export function dilateMask(mask: Uint8Array<ArrayBuffer>, w: number, h: number, r: number): Uint8Array<ArrayBuffer> {
  if (r <= 0) return mask;
  const out = new Uint8Array(mask);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) continue;
      let hit = false;
      for (let dy = -r; dy <= r && !hit; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (mask[yy * w + xx]) { hit = true; break; }
        }
      }
      if (hit) out[y * w + x] = 1;
    }
  }
  return out;
}

/**
 * Inpainting Telea. `src` = RGBA (panjang w*h*4), `mask` = 1 di piksel
 * yang harus diisi. Mengembalikan RGBA baru; piksel di luar mask
 * byte-identical dengan `src`.
 */
export function inpaintTelea(src: Uint8ClampedArray<ArrayBuffer>, mask: Uint8Array<ArrayBuffer>, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(src); // luar mask sudah benar dari sini
  const n = w * h;
  const known = new Uint8Array(n);
  const dist = new Float32Array(n);
  let maskedCount = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i]) { dist[i] = Infinity; maskedCount++; }
    else { known[i] = 1; dist[i] = 0; }
  }
  if (maskedCount === 0 || maskedCount === n) return out;

  const heap = new MinHeap();
  const SQRT2 = Math.SQRT2;
  // Pita awal: piksel mask yang bersebelahan (8 arah) dengan daerah dikenal.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let best = Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (known[yy * w + xx]) best = Math.min(best, (dx && dy) ? SQRT2 : 1);
        }
      }
      if (best !== Infinity) { dist[i] = best; heap.push(best, i); }
    }
  }

  // Gradien per kanal di piksel q (dari tetangga yang sudah dikenal saja).
  function gradX(qx: number, qy: number, c: number): number {
    const qi = (qy * w + qx) * 4 + c;
    const l = qx > 0 && known[qy * w + qx - 1];
    const r = qx + 1 < w && known[qy * w + qx + 1];
    if (l && r) return (out[qi + 4] - out[qi - 4]) / 2;
    if (r) return out[qi + 4] - out[qi];
    if (l) return out[qi] - out[qi - 4];
    return 0;
  }
  function gradY(qx: number, qy: number, c: number): number {
    const qi = (qy * w + qx) * 4 + c;
    const u = qy > 0 && known[(qy - 1) * w + qx];
    const d = qy + 1 < h && known[(qy + 1) * w + qx];
    if (u && d) return (out[qi + w * 4] - out[qi - w * 4]) / 2;
    if (d) return out[qi + w * 4] - out[qi];
    if (u) return out[qi] - out[qi - w * 4];
    return 0;
  }
  const R = 2; // radius jendela tetangga buat isian
  /* GRAD_CLAMP — penjepit koreksi gradien per kanal. Tanpa ini, gradien
     rambut hitam-putih (hitam ↔ putih dalam 1–2 px) menembak isian jauh
     melewati 0–255 lalu ter-clamp jadi 0/255 murni — pita zebra (§5).
     Kalibrasi skenario A (potret B&W, mask pita 6,2%): ±32 masih belang
     (runs/baris 82,8 vs sumber 45,2; ekstrem 13,5%); ±8 kembali ke
     level sumber (runs/baris 41,9; ekstrem 4,6%; sd 47,6 vs 64,1 —
     sedikit lebih halus, wajar buat mode instan). ±0 terlalu blur.
     Jadi ±8: cukup buat membawa arah tepi, tidak cukup buat zebra. */
  const GRAD_CLAMP = 8;
  while (heap.size > 0) {
    const p = heap.pop();
    if (known[p]) continue; // entri basi
    const px = p % w, py = (p / w) | 0;
    const tp = dist[p];
    // Isi warna p dari tetangga yang sudah dikenal (jendela 5×5).
    const acc = [0, 0, 0, 0];
    let wsum = 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (!dx && !dy) continue;
        const qx = px + dx, qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const q = qy * w + qx;
        if (!known[q]) continue;
        const d2 = dx * dx + dy * dy;
        const dst = 1 / d2;
        const lev = 1 / (1 + Math.abs(tp - dist[q]));
        const wt = dst * lev;
        const qi = q * 4;
        // (p − q) = (−dx, −dy): kontribusi = I(q) + grad(q)·(p−q),
        // dengan gradien dijepit ±GRAD_CLAMP biar tidak overshoot jadi zebra.
        for (let c = 0; c < 4; c++) {
          let g = 0;
          if (c < 3) {
            g = gradX(qx, qy, c) * -dx + gradY(qx, qy, c) * -dy;
            if (g > GRAD_CLAMP) g = GRAD_CLAMP; else if (g < -GRAD_CLAMP) g = -GRAD_CLAMP;
          }
          acc[c] += wt * (out[qi + c] + g);
        }
        wsum += wt;
      }
    }
    const pi = p * 4;
    if (wsum > 0) {
      for (let c = 0; c < 4; c++) {
        let v = acc[c] / wsum;
        out[pi + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    } else {
      out[pi] = out[pi + 1] = out[pi + 2] = 0; out[pi + 3] = 255;
    }
    known[p] = 1;
    // Sebarkan jarak ke tetangga mask yang belum terisi.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = px + dx, yy = py + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const r = yy * w + xx;
        if (known[r]) continue;
        const cand = tp + ((dx && dy) ? SQRT2 : 1);
        if (cand < dist[r]) { dist[r] = cand; heap.push(cand, r); }
      }
    }
  }
  return out;
}
