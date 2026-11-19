// History lokal (BARU, pivot): upload + Bersihkan -> IndexedDB
// sirna-history berisi 1 item -> Back -> seksi "Terakhir" tampil ->
// klik kartu -> preview modal (unduh ulang / hapus per item) -> hapus
// per item -> grid kosong -> upload lagi -> "Hapus semua" -> toast.
// History tersembunyi saat editor aktif.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const F = (p) => new URL("./fixtures/" + p, import.meta.url).pathname;
const OUT = "/tmp/history-e2e-result.json";
const log = [];
function note(k, v) { log.push([k, v]); console.log("##", k, "=", typeof v === "string" ? v : JSON.stringify(v)); }

try { execSync("pkill -f 'serve-sirn[a].mjs'"); await new Promise((r) => setTimeout(r, 500)); } catch (_e) {}
const server = spawn("node", [new URL("./serve-sirna.mjs", import.meta.url).pathname, "/home/hatch/workspace/sirna-vite/dist", "4173"], { stdio: "pipe" });
for (let i = 0; i < 20; i++) {
  try { const r = await fetch(BASE); if (r.ok) break; } catch (_e) {}
  await new Promise((r) => setTimeout(r, 500));
}
const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"] });
let proxyOpt = undefined;
try {
  const pu = new URL(process.env.HTTPS_PROXY || process.env.https_proxy || "");
  if (pu.hostname) proxyOpt = { server: `${pu.protocol}//${pu.hostname}:${pu.port}`, username: decodeURIComponent(pu.username), password: decodeURIComponent(pu.password), bypass: "127.0.0.1,localhost" };
} catch (_e) {}
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
const page = await ctx.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

async function historyCount() {
  return await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open("sirna-history", 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("items", "readonly");
      const get = tx.objectStore("items").getAll();
      get.onsuccess = () => { db.close(); resolve(get.result.map((r) => ({ name: r.name, tool: r.tool, label: r.label, hasThumb: !!r.thumb, hasBlob: !!r.blob }))); };
      get.onerror = () => reject(get.error);
    };
  }));
}
async function gridCount() {
  return await page.evaluate(() => document.querySelectorAll("#historyGrid .history-card").length);
}
async function cleanOne() {
  // File-first: upload langsung dari home -> auto-clean (tanpa pilih alat).
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  // Tunggu tombol Simpan apa pun: "Simpan foto" (1 file) atau
  // "Simpan semua (n)" (file pertama masih di antrean setelah Back).
  await page.waitForFunction(() => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan");
  }, { timeout: 60000 });
  await page.waitForTimeout(500);
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  note("historyEmptyAtLoad", await gridCount());
  note("historySectionVisibleAtLoad", await page.evaluate(() => !document.getElementById("historySection").classList.contains("hidden")));
  // (1) Upload + clean -> IndexedDB terisi otomatis.
  await cleanOne();
  note("historyHiddenInEditor", await page.evaluate(() => document.getElementById("historySection").classList.contains("hidden")));
  note("idbAfterClean", await historyCount());
  // (2) Back -> seksi Terakhir tampil, 1 kartu.
  await page.click("#editorBackBtn");
  await page.waitForTimeout(600);
  note("historySectionVisibleAfterBack", await page.evaluate(() => !document.getElementById("historySection").classList.contains("hidden")));
  note("gridAfterClean", await gridCount());
  // (3) Klik kartu -> preview modal: meta + Unduh ulang + Hapus.
  await page.click("#historyGrid .history-card");
  await page.waitForTimeout(500);
  note("previewVisible", await page.evaluate(() => !document.getElementById("previewModal").classList.contains("hidden")));
  note("previewMeta", await page.evaluate(() => document.getElementById("previewMeta")?.textContent?.trim()));
  note("previewDownloadVisible", await page.evaluate(() => !document.getElementById("previewDownload").classList.contains("hidden")));
  note("previewDeleteVisible", await page.evaluate(() => !document.getElementById("previewDelete").classList.contains("hidden")));
  // (4) Hapus per item dari preview -> grid kosong, IDB kosong.
  await page.click("#previewDelete");
  await page.waitForTimeout(600);
  note("gridAfterItemDelete", await gridCount());
  note("idbAfterItemDelete", await historyCount());
  note("toastAfterItemDelete", await page.locator("#toast").textContent());
  note("previewClosedAfterDelete", await page.evaluate(() => document.getElementById("previewModal").classList.contains("hidden")));
  // (5) Upload lagi + clean -> "Hapus semua" via sheet -> toast.
  await cleanOne();
  note("idbAfterClean2", await historyCount());
  await page.click("#editorBackBtn");
  await page.waitForTimeout(600);
  note("gridAfterClean2", await gridCount());
  await page.click("#historyClearBtn");
  await page.waitForTimeout(400);
  note("sheetTitleClearAll", await page.locator("#sheetTitle").textContent());
  await page.click("#sheetConfirm");
  await page.waitForTimeout(600);
  note("gridAfterClearAll", await gridCount());
  note("idbAfterClearAll", await historyCount());
  note("toastAfterClearAll", await page.locator("#toast").textContent());
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
writeFileSync(OUT, JSON.stringify(Object.fromEntries(log), null, 2));
console.log("DONE ->", OUT);
await ctx.close();
server.kill();
process.exit(0);
