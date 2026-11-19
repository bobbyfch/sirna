/* History lokal — hasil bersih tersimpan otomatis di IndexedDB perangkat
   ini saja (tidak diunggah ke mana pun). Ditulis begitu hasil bersih
   tersedia (satu write-point di finishClean / replaceCleaned, app.ts),
   BUKAN saat diunduh. Foto saja — video tidak masuk (blob video bisa
   100 MB+, 20 x video = GB-an di IDB HP). Maks 20, FIFO: yang terlama
   terhapus otomatis. Upsert per [nama file, alat]: satu file yang
   dibersihkan 3x tidak membanjiri history dengan 3 kartu yang sama.
   Best-effort: kalau IDB penuh / tidak tersedia, tool tetap jalan. */

export type HistoryTool = "clean" | "meta" | "watermark";

export interface HistoryEntry {
  id: number;
  createdAt: number; // epoch ms — urutan + FIFO
  name: string; // nama file hasil (buat "Unduh ulang" dengan nama benar)
  tool: HistoryTool;
  label: string; // status bukti, mis. "0 label AI tersisa"
  blob: Blob; // hasil bersih full (bukan thumbnail)
  type: string; // MIME, buat download ulang
  size: number; // byte
  thumb: Blob; // JPEG 320px, latar putih (transparansi dikorbankan di thumbnail saja)
  width: number;
  height: number;
}

export interface HistoryInput {
  name: string;
  tool: HistoryTool;
  label: string;
  blob: Blob;
}

const DB_NAME = "sirna-history";
const DB_VERSION = 1;
const STORE = "items";
export const HISTORY_MAX = 20;

function idbAvailable(): boolean {
  try { return typeof indexedDB !== "undefined"; } catch (_e) { return false; }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!idbAvailable()) { reject(new Error("IndexedDB tidak tersedia.")); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("byCreated", "createdAt");
        store.createIndex("byFileTool", ["name", "tool"], { unique: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Gagal buka IndexedDB."));
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB gagal."));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Transaksi IndexedDB gagal."));
    tx.onabort = () => reject(tx.error || new Error("Transaksi IndexedDB dibatalkan."));
  });
}

/* Thumbnail JPEG sisi panjang max 320px, kualitas 0,72, latar putih.
   Satu code path — transparansi PNG dikorbankan di thumbnail saja,
   bukan di hasil. */
export async function makeThumb(blob: Blob): Promise<{ thumb: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const width = bmp.width, height = bmp.height;
  const scale = Math.min(1, 320 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const thumb = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.72));
  if (!thumb) throw new Error("Gagal buat thumbnail.");
  return { thumb, width, height };
}

async function addOnce(input: HistoryInput): Promise<void> {
  const { thumb, width, height } = await makeThumb(input.blob);
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    // Upsert: hapus entry lama [nama, alat] dulu, lalu tambah baru
    // (id + createdAt baru -> naik ke atas).
    const oldId = await reqToPromise(store.index("byFileTool").getKey([input.name, input.tool]) as IDBRequest<number | undefined>);
    if (oldId !== undefined) store.delete(oldId);
    const entry: Omit<HistoryEntry, "id"> = {
      createdAt: Date.now(),
      name: input.name,
      tool: input.tool,
      label: input.label,
      blob: input.blob,
      type: input.blob.type || "application/octet-stream",
      size: input.blob.size,
      thumb,
      width,
      height,
    };
    store.add(entry);
    await txDone(tx);
    // FIFO 20: hapus yang terlama sebanyak kelebihan.
    const db2 = db;
    const tx2 = db2.transaction(STORE, "readwrite");
    const store2 = tx2.objectStore(STORE);
    const count = await reqToPromise(store2.count());
    if (count > HISTORY_MAX) {
      const excess = count - HISTORY_MAX;
      const idx = store2.index("byCreated");
      let removed = 0;
      await new Promise<void>((resolve, reject) => {
        const curReq = idx.openCursor();
        curReq.onsuccess = () => {
          const cur = curReq.result;
          if (!cur || removed >= excess) { resolve(); return; }
          cur.delete();
          removed++;
          cur.continue();
        };
        curReq.onerror = () => reject(curReq.error || new Error("Gagal baca history."));
      });
    }
    await txDone(tx2);
  } finally {
    db.close();
  }
}

/* Tulis history. Quota penuh -> hapus 5 terlama, coba sekali lagi ->
   masih gagal -> lempar (pemanggil menampilkan toast, tool tetap jalan). */
export async function addHistory(input: HistoryInput): Promise<void> {
  try {
    await addOnce(input);
  } catch (e) {
    const name = (e as Error)?.name || "";
    if (name === "QuotaExceededError" || (e as DOMException)?.code === 22) {
      try {
        const db = await openDb();
        try {
          const tx = db.transaction(STORE, "readwrite");
          const store = tx.objectStore(STORE);
          const idx = store.index("byCreated");
          let removed = 0;
          await new Promise<void>((resolve, reject) => {
            const curReq = idx.openCursor();
            curReq.onsuccess = () => {
              const cur = curReq.result;
              if (!cur || removed >= 5) { resolve(); return; }
              cur.delete();
              removed++;
              cur.continue();
            };
            curReq.onerror = () => reject(curReq.error || new Error("Gagal baca history."));
          });
          await txDone(tx);
        } finally { db.close(); }
      } catch (_e2) { /* lanjut ke percobaan kedua apa adanya */ }
      await addOnce(input);
      return;
    }
    throw e;
  }
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const all = await reqToPromise(store.index("byCreated").getAll() as IDBRequest<HistoryEntry[]>);
    await txDone(tx);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}

export async function getHistory(id: number): Promise<HistoryEntry | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const entry = await reqToPromise(tx.objectStore(STORE).get(id) as IDBRequest<HistoryEntry | undefined>);
    await txDone(tx);
    return entry;
  } finally {
    db.close();
  }
}

export async function deleteHistory(id: number): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function clearHistory(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await txDone(tx);
  } finally {
    db.close();
  }
}

/* Cek cepat tanpa janji: dipakai home untuk menampilkan note
   "History tidak tersedia di browser ini" bila IDB diblokir. */
export function historySupported(): boolean {
  return idbAvailable();
}
