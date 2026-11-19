/* Hapus Duplikat — cari foto yang sama/mirip dengan perceptual hash
   (pHash), 100% lokal, tanpa model, tanpa download.
   pHash: kecilkan ke 32x32 grayscale -> DCT -> ambil 8x8 frekuensi rendah
   (tanpa DC) -> threshold median -> 64 bit. Dua foto yang sama persis
   punya hash identik (jarak 0); yang di-resize/dikompres ulang/diedit
   ringan berjarak kecil (<=8). TIDAK PERNAH auto-delete: user yang
   memilih mana yang disimpan, sisanya dihapus lewat satu tombol eksplisit.
   Grup dihitung dengan union-find (jarak Hamming <= 8, transitif). */

export interface DedupEntry {
  id: number;
  name: string;
  url: string; // object URL thumbnail
  hash: bigint;
}

export interface DedupGroup {
  entries: DedupEntry[];
}

/* ── pHash ── */
const COS: Float64Array = (() => {
  const t = new Float64Array(32 * 32);
  for (let u = 0; u < 32; u++) {
    for (let x = 0; x < 32; x++) {
      t[u * 32 + x] = Math.cos((Math.PI * (2 * x + 1) * u) / 64);
    }
  }
  return t;
})();

function dct1d(input: Float64Array): Float64Array {
  const out = new Float64Array(32);
  for (let u = 0; u < 32; u++) {
    let s = 0;
    for (let x = 0; x < 32; x++) s += input[x] * COS[u * 32 + x];
    out[u] = s;
  }
  return out;
}

export async function phashImage(blob: Blob): Promise<bigint> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = 32; c.height = 32;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0, 32, 32);
  bmp.close();
  const d = ctx.getImageData(0, 0, 32, 32).data;
  // Grayscale 32x32 (luminance).
  const g = new Float64Array(32 * 32);
  for (let i = 0; i < 32 * 32; i++) {
    g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  }
  // DCT 2D separable: baris lalu kolom.
  const tmp = new Float64Array(32 * 32);
  for (let y = 0; y < 32; y++) {
    const row = dct1d(g.subarray(y * 32, y * 32 + 32));
    tmp.set(row, y * 32);
  }
  for (let x = 0; x < 32; x++) {
    const col = new Float64Array(32);
    for (let y = 0; y < 32; y++) col[y] = tmp[y * 32 + x];
    const out = dct1d(col);
    for (let y = 0; y < 32; y++) tmp[y * 32 + x] = out[y];
  }
  // 8x8 frekuensi rendah tanpa DC [0,0] -> 63 koefisien -> median.
  const vals: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) continue;
      vals.push(tmp[y * 32 + x]);
    }
  }
  const sorted = [...vals].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  let hash = 0n;
  for (const v of vals) {
    hash = (hash << 1n) | (v > med ? 1n : 0n);
  }
  return hash;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b, n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/* Union-find: dua entri satu grup kalau jaraknya <= maxDist (transitif —
   A~B, B~C => A,B,C satu grup walau A~C jauh). */
export function groupDuplicates(entries: DedupEntry[], maxDist = 8): DedupGroup[] {
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (hamming(entries[i].hash, entries[j].hash) <= maxDist) {
        const ri = find(i), rj = find(j);
        if (ri !== rj) parent[ri] = rj;
      }
    }
  }
  const map = new Map<number, DedupEntry[]>();
  entries.forEach((e, i) => {
    const r = find(i);
    if (!map.has(r)) map.set(r, []);
    map.get(r)!.push(e);
  });
  return [...map.values()]
    .filter((g) => g.length > 1)
    .map((entries) => ({ entries }))
    .sort((a, b) => b.entries.length - a.entries.length);
}

/* ── Tampilan grup (cross-file view) ──
   Tiap grup: baris thumbnail, masing-masing dengan radio "Simpan ini"
   (default: entri pertama = yang paling dulu diunggah) + badge
   "akan dihapus" di yang tidak disimpan + tombol hapus per grup.
   onRemove(removeIds, keepIds) dipanggil HANYA saat user menekan tombol —
   tidak ada yang terhapus otomatis. */
export function renderDedupGroups(
  container: HTMLElement,
  groups: DedupGroup[],
  onRemove: (removeIds: number[], keepIds: number[]) => void
): void {
  if (groups.length === 0) {
    container.innerHTML = '<p class="dedup-empty">Tidak ada duplikat — semua foto beda.</p>';
    return;
  }
  container.innerHTML = groups.map((g, gi) => {
    const items = g.entries.map((e, ei) => {
      const keep = ei === 0;
      return '<label class="dedup-item' + (keep ? "" : " to-remove") + '" data-g="' + gi + '" data-id="' + e.id + '">' +
        '<input type="radio" name="dedup-keep-' + gi + '" value="' + e.id + '"' + (keep ? " checked" : "") + '>' +
        '<img src="' + e.url + '" alt="">' +
        '<span class="dedup-name">' + esc(e.name) + '</span>' +
        '<span class="dedup-keep-label">' + (keep ? "Disimpan ✓" : "Akan dihapus") + '</span>' +
        '</label>';
    }).join("");
    return '<section class="dedup-group" data-g="' + gi + '">' +
      '<h3 class="dedup-group-title">Grup ' + (gi + 1) + ' — ' + g.entries.length + ' file mirip</h3>' +
      '<div class="dedup-row">' + items + '</div>' +
      '<button type="button" class="dedup-remove grad-bg" data-g="' + gi + '">Hapus ' + (g.entries.length - 1) + ' duplikat di grup ini</button>' +
      '</section>';
  }).join("");
  // Radio ganti yang disimpan: update label + badge di grup itu.
  container.querySelectorAll('input[type="radio"]').forEach((r) => {
    r.addEventListener("change", () => {
      const gi = (r as HTMLInputElement).name.replace("dedup-keep-", "");
      const group = container.querySelector('.dedup-group[data-g="' + gi + '"]');
      if (!group) return;
      const keepId = (r as HTMLInputElement).value;
      group.querySelectorAll(".dedup-item").forEach((it) => {
        const isKeep = (it as HTMLElement).dataset.id === keepId;
        it.classList.toggle("to-remove", !isKeep);
        const lbl = it.querySelector(".dedup-keep-label");
        if (lbl) lbl.textContent = isKeep ? "Disimpan ✓" : "Akan dihapus";
      });
      const btn = group.querySelector(".dedup-remove") as HTMLButtonElement;
      if (btn) {
        const n = group.querySelectorAll(".dedup-item").length - 1;
        btn.textContent = "Hapus " + n + " duplikat di grup ini";
      }
    });
  });
  // Tombol hapus per grup.
  container.querySelectorAll(".dedup-remove").forEach((b) => {
    b.addEventListener("click", () => {
      const gi = (b as HTMLElement).dataset.g;
      const group = container.querySelector('.dedup-group[data-g="' + gi + '"]');
      if (!group) return;
      const checked = group.querySelector('input[type="radio"]:checked') as HTMLInputElement;
      const keepId = checked ? Number(checked.value) : null;
      const removeIds: number[] = [];
      const keepIds: number[] = [];
      group.querySelectorAll(".dedup-item").forEach((it) => {
        const id = Number((it as HTMLElement).dataset.id);
        if (id === keepId) keepIds.push(id);
        else removeIds.push(id);
      });
      onRemove(removeIds, keepIds);
    });
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
