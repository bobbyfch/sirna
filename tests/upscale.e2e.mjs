// E2E Perbesar: Playwright Chromium, serve dist/ lokal.
// Langkah: 1) load awal = NOL request model; 2) pilih alat Perbesar,
// upload foto tes (800x600), buka modal -> judul "Perbesar", catatan
// "Dihitung AI di HP kamu (Real-ESRGAN x4v3, 4,6 MB…)"; 3) [Perbesar] 2x
// -> 1600x1200 (Real-ESRGAN, model di-intercept -> fixture lokal),
// piksel tengah tetap merah, sudut utuh; 4) "Tahan: lihat asli" ->
// preview kembali ke 800x600, lepas -> 1600x1200 lagi; 5) Urungkan hasil
// -> bar hilang; 6) 3x -> input di-cap 768 px -> 2304x1728; 7) Simpan
// hasil -> kartu "Foto diperbesar" + versi "Perbesar"; 8) Unduh -> PNG
// valid (run kedua: 0 request model baru, cache); 9) viewport 390px:
// tanpa overflow, 0 console error.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // sertifikat self-signed server tes lokal
const TEST_IMG = new URL("./fixtures/erase-test.png", import.meta.url).pathname; // 800x600: gradien (x,y,128) + lingkaran merah r=60 di (400,300) + kotak hijau (60..200,420..500)
const ESRGAN_MODEL = new URL("./fixtures/models/realesr-general-x4v3.onnx", import.meta.url).pathname;
const OUT = "/tmp/upscale-e2e-result.json";
const log = [];
function note(k, v) { log.push([k, v]); console.log("##", k, "=", typeof v === "string" ? v : JSON.stringify(v)); }

const MODEL_RE = /huggingface\.co|\.onnx/i;
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
const modelReqs = () => reqs.filter((u) => MODEL_RE.test(u));
const ortReqs = () => reqs.filter((u) => ORT_RE.test(u));
// Intercept unduhan model Real-ESRGAN -> fixture lokal (tanpa internet).
let pendingModel = null;
await page.route("**/huggingface.co/**", async (route) => {
  const u = route.request().url();
  if (!u.includes("realesr-general-x4v3.onnx")) return route.abort();
  pendingModel = ESRGAN_MODEL;
  return route.fulfill({ path: ESRGAN_MODEL });
});
await page.route("**/cdn-lfs.huggingface.co/**", async (route) => {
  if (!pendingModel) return route.abort();
  return route.fulfill({ path: pendingModel });
});

async function readPreviewPixels(pg) {
  return await pg.evaluate(async () => {
    const img = document.getElementById("upPreview");
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    const at = (ix, iy) => { const i = (iy * c.width + ix) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2], d.data[i + 3]]; };
    return { w: c.width, h: c.height, center: at(Math.floor(c.width / 2), Math.floor(c.height / 2)), corner: at(10, 10), green: at(Math.floor(c.width * 0.1625), Math.floor(c.height * 0.766)) };
  });
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  note("modelReqsOnLoad", modelReqs().length === 0 ? "NONE (good)" : modelReqs());

  await page.click('button[data-tool="upscale"]');
  await page.waitForSelector("#panel-cleaner:not(.hidden)", { timeout: 10000 });
  await page.setInputFiles("#fileInput", TEST_IMG);
  await page.waitForSelector("#list .card", { timeout: 30000 });
  await page.waitForTimeout(500);

  await page.click('button[data-act="upscale"]');
  await page.waitForSelector("#upModal:not(.hidden)", { timeout: 10000 });
  note("modalTitle", await page.evaluate(() => document.getElementById("upTitle").textContent));
  note("modalSub", await page.locator("#upSub").textContent());
  note("noteText", await page.locator("#upNote").textContent());
  note("modelReqsAfterOpen", modelReqs().length);
  const px0 = await readPreviewPixels(page);
  note("previewOriginal", px0);

  // 2x (default) — Real-ESRGAN; bar progres tile harus sempat tampil.
  const progressSeen = page.waitForSelector("#upModelProgress:not(.hidden)", { timeout: 30000 }).then(() => true).catch(() => false);
  const t1 = Date.now();
  await page.click("#upRun");
  await page.waitForSelector("#upResultBar:not(.hidden)", { timeout: 180000 });
  note("run2xMs", Date.now() - t1);
  note("progressBarSeen", await progressSeen);
  note("run2xNote", await page.locator("#upNote").textContent());
  note("modelReqsAfterRun", modelReqs());
  note("modelReqCount", modelReqs().length); // harus 1: URL x4v3 ter-pin, sekali
  note("ortReqsAfterRun", ortReqs());
  const px2 = await readPreviewPixels(page);
  note("result2x", px2);
  note("is2x", px2.w === 1600 && px2.h === 1200);
  note("centerStillRed", px2.center[0] > 180 && px2.center[1] < 80 && px2.center[2] < 80);
  note("cornerIntact", px2.corner[0] < 20 && px2.corner[1] < 20 && Math.abs(px2.corner[2] - 128) < 20);

  // "Tahan: lihat asli" — tahan -> preview kembali 800x600, lepas -> 1600x1200.
  const cmpBox = await page.locator("#upCompare").boundingBox();
  await page.mouse.move(cmpBox.x + cmpBox.width / 2, cmpBox.y + cmpBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  note("naturalWhileHolding", await page.evaluate(() => { const i = document.getElementById("upPreview"); return [i.naturalWidth, i.naturalHeight]; }));
  await page.mouse.up();
  await page.waitForTimeout(300);
  note("naturalAfterRelease", await page.evaluate(() => { const i = document.getElementById("upPreview"); return [i.naturalWidth, i.naturalHeight]; }));

  // Urungkan hasil -> bar hilang.
  await page.click("#upUndoResult");
  await page.waitForTimeout(400);
  note("resultBarHiddenAfterUndo", await page.evaluate(() => document.getElementById("upResultBar").classList.contains("hidden")));
  note("compareHiddenAfterUndo", await page.evaluate(() => document.getElementById("upCompare").classList.contains("hidden")));

  // 3x — input di-cap 768 px (WASM-only): 768x576 -> 2304x1728.
  await page.click('[data-up-scale="3"]');
  await page.waitForTimeout(300);
  note("warn3Visible", await page.evaluate(() => !document.getElementById("upWarn3").classList.contains("hidden")));
  const t3 = Date.now();
  await page.click("#upRun");
  await page.waitForSelector("#upResultBar:not(.hidden)", { timeout: 180000 });
  note("run3xMs", Date.now() - t3);
  note("run3xNote", await page.locator("#upNote").textContent());
  const px3 = await readPreviewPixels(page);
  note("result3x", { w: px3.w, h: px3.h });
  note("is3x", px3.w === 2304 && px3.h === 1728);

  // Simpan hasil -> kartu update + versi "Perbesar".
  await page.click("#upSave");
  await page.waitForTimeout(800);
  const cardText = await page.locator("#list").textContent();
  note("cardMentionsUpscale", /Foto diperbesar/.test(cardText));
  note("cardHasVersionPerbesar", /Perbesar/.test(cardText));
  note("modalClosedAfterSave", await page.evaluate(() => document.getElementById("upModal").classList.contains("hidden")));

  // Unduh hasil -> PNG valid (buka lagi dulu, run lagi — model sudah
  // di-cache, jadi 0 request model baru).
  await page.click('button[data-act="upscale"]');
  await page.waitForSelector("#upModal:not(.hidden)", { timeout: 10000 });
  const reqsBeforeRun2 = modelReqs().length;
  await page.click("#upRun");
  await page.waitForSelector("#upResultBar:not(.hidden)", { timeout: 180000 });
  note("modelReqsRun2", modelReqs().length - reqsBeforeRun2); // harus 0 (cache)
  const dl = page.waitForEvent("download", { timeout: 30000 });
  await page.click("#upDownload");
  const download = await dl;
  const dlPath = "/tmp/up-downloaded.png";
  await download.saveAs(dlPath);
  const buf = readFileSync(dlPath);
  note("downloadFile", download.suggestedFilename() + " " + buf.length + " bytes, magic=" + buf.subarray(0, 8).toString("hex"));
  await page.click("#upClose");
  note("modelReqsTotal", modelReqs()); // tetap 1 (x4v3 ter-pin, sekali)
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
await p2.click('button[data-tool="upscale"]');
await p2.setInputFiles("#fileInput", TEST_IMG);
await p2.waitForSelector("#list .card", { timeout: 30000 });
await p2.click('button[data-act="upscale"]');
await p2.waitForSelector("#upModal:not(.hidden)", { timeout: 10000 });
await p2.waitForTimeout(800);
const overflow2 = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
note("overflow390Modal", overflow2);
note("consoleErrors390", errs2.slice(0, 10));

await browser.close();
server.kill();
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
