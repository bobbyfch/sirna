// E2E Hapus Latar: Playwright Chromium, serve dist/ lokal.
// Langkah: 1) load awal = NOL request model; 2) pilih alat Hapus Latar,
// upload foto tes (siluet orang di latar biru gradien), buka modal ->
// TIDAK ADA lagi kontrol chroma-key (swatch/toleransi/mode); preview awal
// = foto asli (sudut utuh); 3) [Hapus latar] -> ORMBG int8 (44 MB,
// di-intercept -> fixture lokal) -> PNG transparan resolusi penuh
// 800x600 (sudut alpha ~0, wajah & torso utuh, warna subjek utuh);
// 4) Simpan hasil -> kartu "Latar dihapus" + versi "Latar";
// 5) buka lagi + run kedua -> 0 request model BARU (Cache Storage);
// 6) Unduh -> PNG valid; 7) viewport 390px: tanpa overflow, 0 console error.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // sertifikat self-signed server tes lokal
const TEST_IMG = new URL("./fixtures/bg-test.png", import.meta.url).pathname; // 800x600: gradien biru + siluet orang (kepala kulit + torso gelap)
const ORMBG_MODEL = new URL("./fixtures/models/ormbg_int8.onnx", import.meta.url).pathname;
const OUT = "/tmp/background-e2e-result.json";
const log = [];
function note(k, v) { log.push([k, v]); console.log("##", k, "=", typeof v === "string" ? v : JSON.stringify(v)); }

const NO_MODEL_RE = /huggingface\.co|\.onnx/i;
const ORT_RE = /\/ort\//;

try { execSync("pkill -f 'serve-sirn[a].mjs'"); await new Promise((r) => setTimeout(r, 500)); } catch (_e) {}
const server = spawn("node", [new URL("./serve-sirna.mjs", import.meta.url).pathname, "/home/hatch/workspace/sirna-vite/dist", "4173"], { stdio: "pipe" });
for (let i = 0; i < 20; i++) {
  try { const r = await fetch(BASE); if (r.ok) break; } catch (_e) { /* belum */ }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"] });
let proxyOpt = undefined;
try {
  const pu = new URL(process.env.HTTPS_PROXY || process.env.https_proxy || "");
  if (pu.hostname) proxyOpt = { server: `${pu.protocol}//${pu.hostname}:${pu.port}`, username: decodeURIComponent(pu.username), password: decodeURIComponent(pu.password), bypass: "127.0.0.1,localhost" };
} catch (_e) { /* tanpa proxy */ }
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, serviceWorkers: "block", ...(proxyOpt ? { proxy: proxyOpt } : {}) });
const page = await ctx.newPage();
const reqs = [];
const consoleErrors = [];
const pageErrors = [];
page.on("request", (r) => reqs.push(r.url()));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("requestfailed", (r) => note("REQ-FAILED", r.url() + " :: " + (r.failure()?.errorText || "")));
const modelReqs = () => reqs.filter((u) => NO_MODEL_RE.test(u));
const ortReqs = () => reqs.filter((u) => ORT_RE.test(u));
// Intercept unduhan model ORMBG -> fixture lokal (tanpa internet).
let pendingModel = null;
await page.route("**/huggingface.co/**", async (route) => {
  const u = route.request().url();
  if (!u.includes("model_quantized.onnx")) return route.abort();
  pendingModel = ORMBG_MODEL;
  return route.fulfill({ path: ORMBG_MODEL });
});
await page.route("**/cdn-lfs.huggingface.co/**", async (route) => {
  if (!pendingModel) return route.abort();
  return route.fulfill({ path: pendingModel });
});

/* Baca piksel preview #bgPreview (foto asli / hasil ekspor). */
async function readPreviewPixels(pg) {
  return await pg.evaluate(async () => {
    const img = document.getElementById("bgPreview");
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    const at = (ix, iy) => { const i = (iy * c.width + ix) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2], d.data[i + 3]]; };
    // Sudut = latar -> alpha harus ~0. Tengah wajah & torso = subjek -> alpha 255.
    return {
      w: c.width, h: c.height,
      cornerTL: at(10, 10), cornerTR: at(790, 10), cornerBL: at(10, 590), cornerBR: at(790, 590),
      face: at(400, 250), torso: at(400, 500),
    };
  });
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  note("isolated", await page.evaluate(() => self.crossOriginIsolated));
  note("modelReqsOnLoad", modelReqs().length === 0 ? "NONE (good)" : modelReqs());

  // Pilih alat Hapus Latar Polos, lalu upload (file cuma diantre — alat ini
  // tidak auto-clean; tombol Simpan baru muncul setelah ada hasil).
  await page.click('button[data-sidebar-tool="background"]');
  await page.waitForSelector("#panel-cleaner:not(.hidden)", { timeout: 10000 });
  note("pickerHasBackground", await page.evaluate(() => !!document.querySelector('button[data-tool="background"]')));
  note("pickerName", await page.evaluate(() => document.querySelector('button[data-tool="background"] b').textContent));
  await page.setInputFiles("#fileInput", TEST_IMG);
  await page.waitForSelector("#list .card", { timeout: 30000 });
  note("cardVisible", true);
  await page.waitForTimeout(500);

  // Buka modal dari rel alat kartu (chip kanonis) + tombol utama.
  await page.click('#list [data-tool-switch="background"]');
  await page.click("#primaryBtn");
  await page.waitForSelector("#bgModal:not(.hidden)", { timeout: 10000 });
  note("modalOpen", await page.evaluate(() => !document.getElementById("bgModal").classList.contains("hidden")));
  note("modalTitle", await page.evaluate(() => document.getElementById("bgTitle").textContent));
  // Chroma-key DIHAPUS: tidak ada lagi swatch/toleransi/mode.
  note("noChromaControls", await page.evaluate(() => document.getElementById("bgKeySwatch") === null && document.getElementById("bgKeyLabel") === null && document.getElementById("bgTol") === null && document.querySelectorAll("[data-bg-mode]").length === 0));
  note("hasModelBar", await page.evaluate(() => document.getElementById("bgModelBar") !== null));
  note("modelReqsAfterOpen", modelReqs().length); // buka modal tidak mengunduh apa pun
  // Preview awal = foto asli (sudut masih utuh, alpha 255).
  const px0 = await readPreviewPixels(page);
  note("previewOriginal", px0);
  note("cornersOpaqueBeforeRun", [px0.cornerTL, px0.cornerTR, px0.cornerBL, px0.cornerBR].every((p) => p[3] > 200));

  // [Hapus latar]: ORMBG int8 — model diunduh sekali saat ini.
  const progressSeen = page.waitForSelector("#bgModelProgress:not(.hidden)", { timeout: 30000 }).then(() => true).catch(() => false);
  const t1 = Date.now();
  await page.click("#bgRun");
  await page.waitForSelector("#bgResultBar:not(.hidden)", { timeout: 180000 });
  note("runMs", Date.now() - t1);
  note("progressBarSeen", await progressSeen);
  note("runNote", await page.locator("#bgNote").textContent());
  note("modelReqsAfterRun", modelReqs());
  note("modelReqCount", modelReqs().length); // harus 1: URL ORMBG ter-pin, sekali
  note("ortReqsAfterRun", ortReqs());
  const px = await readPreviewPixels(page);
  note("resultPixels", px);
  note("exportFullRes", px.w === 800 && px.h === 600);
  note("exportCornersTransparent", [px.cornerTL, px.cornerTR, px.cornerBL, px.cornerBR].every((p) => p[3] < 16));
  note("exportSubjectIntact", px.face[3] > 240 && px.torso[3] > 240 && px.face[0] === 222 && px.torso[0] < 80);

  // Simpan hasil -> kartu update + versi "Latar".
  await page.click("#bgSave");
  await page.waitForTimeout(800);
  const cardText = await page.locator("#list").textContent();
  note("cardMentionsBg", /Latar dihapus/.test(cardText));
  note("cardHasVersionLatar", /Latar/.test(cardText));
  note("modalClosedAfterSave", await page.evaluate(() => document.getElementById("bgModal").classList.contains("hidden")));

  // Buka lagi + run kedua: 0 request model BARU (Cache Storage — model
  // sudah di HP). Timeout run kedua lebih pendek (tanpa unduh).
  await page.click('#list [data-tool-switch="background"]');
  await page.click("#primaryBtn");
  await page.waitForSelector("#bgModal:not(.hidden)", { timeout: 10000 });
  const reqsBeforeRun2 = modelReqs().length;
  const t2 = Date.now();
  await page.click("#bgRun");
  await page.waitForSelector("#bgResultBar:not(.hidden)", { timeout: 120000 });
  note("run2Ms", Date.now() - t2);
  note("modelReqsRun2", modelReqs().length - reqsBeforeRun2); // harus 0 (cache)

  // Unduh hasil -> PNG valid.
  const dl = page.waitForEvent("download", { timeout: 30000 });
  await page.click("#bgDownload");
  const download = await dl;
  const dlPath = "/tmp/bg-downloaded.png";
  await download.saveAs(dlPath);
  const buf = readFileSync(dlPath);
  note("downloadFile", download.suggestedFilename() + " " + buf.length + " bytes, magic=" + buf.subarray(0, 8).toString("hex"));
  note("downloadIsPng", download.suggestedFilename().endsWith(".png"));
  await page.click("#bgClose");
  note("modelReqsTotal", modelReqs()); // tetap 1 (ORMBG ter-pin, sekali)
  note("modelReqCountTotal", modelReqs().length);
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
note("allReqsTail", reqs.filter((u) => !u.startsWith("https://127.0.0.1")).slice(0, 20));

// Viewport 390px: overflow horizontal + console error di halaman + modal.
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
const p2 = await ctx2.newPage();
const errs2 = [];
p2.on("console", (m) => { if (m.type() === "error") errs2.push(m.text()); });
p2.on("pageerror", (e) => errs2.push(String(e)));
await p2.goto(BASE, { waitUntil: "networkidle" });
await p2.waitForTimeout(1000);
await p2.click('button[data-tool="background"]');
await p2.setInputFiles("#fileInput", TEST_IMG);
await p2.waitForSelector("#list .card", { timeout: 30000 });
await p2.click('#list [data-tool-switch="background"]');
await p2.click("#primaryBtn");
await p2.waitForSelector("#bgModal:not(.hidden)", { timeout: 10000 });
await p2.waitForTimeout(800);
const overflow2 = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
note("overflow390Modal", overflow2);
note("consoleErrors390", errs2.slice(0, 10));

await browser.close();
server.kill();
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
