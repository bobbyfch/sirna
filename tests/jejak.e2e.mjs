// E2E Hapus Jejak: Playwright Chromium, serve dist/ lokal.
// Langkah: 1) load awal = NOL request model; 2) pilih alat Hapus Jejak,
// upload foto tes yang memang berisi jejak (IMG_20261118_143201.png:
// tEXt prompt + tEXt seed + tIME + nama file berpola tanggal); 3) buka
// modal -> daftar jejak berisi Teks PNG, Waktu pembuatan, Nama file;
// 4) [Hapus jejak] -> dicek ulang 0 jejak di dalam file (baris nama file
// tetap — nama tidak diubah alat ini); 5) Simpan -> kartu "Jejak
// dihapus" + versi "Jejak"; 6) Unduh -> PNG hasil NOL chunk tEXt/iTXt/
// zTXt/tIME/eXIf; 7) viewport 390px: tanpa overflow, 0 console error.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const TEST_IMG = new URL("./fixtures/IMG_20261118_143201.png", import.meta.url).pathname; // 800x600 + tEXt prompt/seed + tIME + nama berpola tanggal
const OUT = "/tmp/jejak-e2e-result.json";
const log = [];
function note(k, v) { log.push([k, v]); console.log("##", k, "=", typeof v === "string" ? v : JSON.stringify(v)); }
const NO_MODEL_RE = /huggingface|staticimgly|onnxruntime|ort-wasm|migan|lama|\.onnx|isnet/i;
function pngChunks(buf) {
  const out = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const typ = buf.toString("ascii", pos + 4, pos + 8);
    out.push(typ);
    pos += 12 + len;
    if (typ === "IEND") break;
  }
  return out;
}

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
const reqs = [];
const consoleErrors = [];
const pageErrors = [];
page.on("request", (r) => reqs.push(r.url()));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));
const modelReqs = () => reqs.filter((u) => NO_MODEL_RE.test(u));
try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  note("modelReqsOnLoad", modelReqs().length === 0 ? "NONE (good)" : modelReqs());
  note("inputChunks", pngChunks(readFileSync(TEST_IMG)).join(","));

  await page.click('button[data-tool="jejak"]');
  await page.waitForSelector("#panel-cleaner:not(.hidden)", { timeout: 10000 });
  await page.setInputFiles("#fileInput", TEST_IMG);
  await page.waitForSelector("#list .card", { timeout: 30000 });
  await page.waitForTimeout(500);

  await page.click('button[data-act="jejak"]');
  await page.waitForSelector("#jejakModal:not(.hidden)", { timeout: 10000 });
  note("modalTitle", await page.evaluate(() => document.getElementById("jejakTitle").textContent));
  note("modalSub", await page.locator("#jejakSub").textContent());
  await page.waitForFunction(() => document.getElementById("jejakList").children.length > 0, { timeout: 10000 });
  const listText = await page.locator("#jejakList").textContent();
  note("listText", listText);
  note("listHasTextChunks", /Teks PNG/.test(listText));
  note("listHasTime", /Waktu pembuatan/.test(listText));
  note("listHasFilename", /Nama file/.test(listText));

  // [Hapus jejak] -> dicek ulang 0 jejak di dalam file.
  const t1 = Date.now();
  await page.click("#jejakRun");
  await page.waitForSelector("#jejakResultBar:not(.hidden)", { timeout: 30000 });
  note("scrubMs", Date.now() - t1);
  note("scrubNote", await page.locator("#jejakNote").textContent());
  const listAfter = await page.locator("#jejakList").textContent();
  note("listAfterScrub", listAfter);
  note("blobTracesGone", !/Teks PNG/.test(listAfter) && !/Waktu pembuatan/.test(listAfter));
  note("filenameRowStays", /Nama file/.test(listAfter)); // nama file TIDAK diubah alat ini

  // Simpan -> kartu + versi.
  await page.click("#jejakSave");
  await page.waitForTimeout(800);
  const cardText = await page.locator("#list").textContent();
  note("cardMentionsJejak", /Jejak dihapus/.test(cardText));
  note("modalClosedAfterSave", await page.evaluate(() => document.getElementById("jejakModal").classList.contains("hidden")));

  // Unduh hasil -> PNG hasil NOL chunk jejak. Buka lagi DARI ASLI (versi
  // tersimpan sudah bersih, jadi tombol Hapus nonaktif) lalu hapus & unduh.
  await page.click('button[data-act="jejak"]');
  await page.waitForSelector("#jejakModal:not(.hidden)", { timeout: 10000 });
  await page.click("#jejakUseOriginal");
  await page.waitForFunction(() => /Teks PNG/.test(document.getElementById("jejakList").textContent), { timeout: 10000 });
  await page.click("#jejakRun");
  await page.waitForSelector("#jejakResultBar:not(.hidden)", { timeout: 30000 });
  const dl = page.waitForEvent("download", { timeout: 30000 });
  await page.click("#jejakDownload");
  const download = await dl;
  const dlPath = "/tmp/jejak-downloaded.png";
  await download.saveAs(dlPath);
  const buf = readFileSync(dlPath);
  const chunks = pngChunks(buf);
  note("downloadFile", download.suggestedFilename() + " " + buf.length + " bytes, chunks=" + chunks.join(","));
  note("downloadClean", !chunks.some((c) => ["tEXt", "iTXt", "zTXt", "tIME", "eXIf"].includes(c)));
  await page.click("#jejakClose");
  note("modelReqsTotal", modelReqs().length === 0 ? "NONE (good)" : modelReqs());
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
note("allReqsTail", reqs.filter((u) => !u.startsWith("https://127.0.0.1")).slice(0, 20));

// Viewport 390px.
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
const p2 = await ctx2.newPage();
const errs2 = [];
p2.on("console", (m) => { if (m.type() === "error") errs2.push(m.text()); });
p2.on("pageerror", (e) => errs2.push(String(e)));
await p2.goto(BASE, { waitUntil: "networkidle" });
await p2.waitForTimeout(1000);
await p2.click('button[data-tool="jejak"]');
await p2.setInputFiles("#fileInput", TEST_IMG);
await p2.waitForSelector("#list .card", { timeout: 30000 });
await p2.click('button[data-act="jejak"]');
await p2.waitForSelector("#jejakModal:not(.hidden)", { timeout: 10000 });
await p2.waitForTimeout(800);
const overflow2 = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
note("overflow390Modal", overflow2);
note("consoleErrors390", errs2.slice(0, 10));

await browser.close();
server.kill();
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
