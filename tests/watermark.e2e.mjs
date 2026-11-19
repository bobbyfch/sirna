// E2E Hapus Watermark: Playwright Chromium, serve dist/ lokal.
// Langkah: 1) load awal = NOL request model/runtime apa pun; 2) upload foto
// tes (sparkle putih pojok kanan bawah + badge "Made with AI" pojok kiri
// bawah) -> buka Hapus Watermark: auto-detect harus menandai KEDUA
// mark merah (overlay), judul modal "Hapus Watermark"; 3) Hapus (Telea,
// satu-satunya mode) -> mark hilang, luar mask byte-identical; 4) Unduh ->
// file valid; 5) Simpan hasil -> kartu update "Watermark dihapus";
// 6) foto tanpa watermark -> "Tidak ketemu tanda otomatis" (B3), overlay
// kosong; 7) viewport 390px: tanpa overflow horizontal, 0 console error.
// Revert model (19 Nov 2026): tidak ada lagi MI-GAN/LaMa — tes ini
// membuktikan tidak ada satu pun request model selama seluruh sesi.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // sertifikat self-signed server tes lokal
const TEST_IMG = new URL("./fixtures/wm-test.png", import.meta.url).pathname; // 800x600: gradien + kotak hijau + lingkaran merah + sparkle putih (742,545) + badge "Made with AI" (24..168,544..576)
const CLEAN_IMG = new URL("./fixtures/wm-clean.png", import.meta.url).pathname; // 800x600: sama, tanpa watermark
const OUT = "/tmp/watermark-e2e-result.json";
const log = [];
function note(k, v) { log.push([k, v]); console.log("##", k, "=", typeof v === "string" ? v : JSON.stringify(v)); }

const IMG_DATA_URL = "data:image/png;base64," + readFileSync(TEST_IMG).toString("base64");
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
// Sirna tidak lagi mengunduh apa pun saat jalan — guard di bawah justru
// membuktikan tidak ada satu pun request ke host model/runtime.
const NO_MODEL_RE = /huggingface|staticimgly|onnxruntime|ort-wasm|migan|lama|\.onnx|isnet/i;
const modelReqs = () => reqs.filter((u) => NO_MODEL_RE.test(u));
const page = await ctx.newPage();
const reqs = [];
const consoleErrors = [];
const pageErrors = [];
page.on("request", (r) => reqs.push(r.url()));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("requestfailed", (r) => note("REQ-FAILED", r.url() + " :: " + (r.failure()?.errorText || "")));

/* Baca overlay merah (mask): piksel r>200,g<120,b<120,a>50. */
async function readOverlay() {
  return await page.evaluate(() => {
    const c = document.getElementById("eraseOverlay");
    const x = c.getContext("2d");
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const isRed = (ix, iy) => { const i = (iy * c.width + ix) * 4; return d[i] > 200 && d[i + 1] < 120 && d[i + 2] < 120 && d[i + 3] > 50; };
    let total = 0, br = 0, bl = 0;
    for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) {
      if (!isRed(xx, yy)) continue;
      total++;
      if (xx >= 700 && yy >= 500) br++;
      if (xx <= 200 && yy >= 500) bl++;
    }
    return { w: c.width, h: c.height, total, br, bl, frac: total / (c.width * c.height) };
  });
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  note("heroHasWatermark", await page.evaluate(() => document.body.textContent.includes("Hapus Watermark")));
  note("modelReqsOnLoad", modelReqs().length === 0 ? "NONE (good)" : modelReqs());

  // Upload foto tes (ada watermark) — pilih Bersihkan dulu (tanpa alat,
  // file cuma diantre; arah 19 Nov 2026).
  await page.click('[data-tool="clean"]');
  await page.waitForTimeout(500);
  await page.setInputFiles("#fileInput", TEST_IMG);
  await page.waitForSelector('button[data-act="save"]:not(.hidden)', { timeout: 30000 });
  note("cleanDone", "save button visible");
  await page.waitForTimeout(500);

  // Buka Hapus Watermark — auto-detect harus sudah menandai kedua mark.
  await page.click('button[data-act="watermark"]');
  await page.waitForSelector("#eraseModal:not(.hidden)", { timeout: 10000 });
  await page.waitForTimeout(600); // deteksi sinkron, kasih waktu render overlay
  note("modalTitle", await page.evaluate(() => document.getElementById("eraseTitle").textContent));
  note("detectNote", await page.locator("#eraseNote").textContent());
  const ov = await readOverlay();
  note("overlayAfterOpen", ov);
  note("detectFoundBoth", ov.br > 200 && ov.bl > 200 && ov.frac < 0.05);

  // Hapus (mode Instan = default, tanpa coret manual — mask dari deteksi).
  await page.click("#eraseRun");
  await page.waitForSelector("#eraseResultBar:not(.hidden)", { timeout: 60000 });
  note("noteText", await page.locator("#eraseNote").textContent());
  const after = await page.evaluate((imgDataUrl) => {
    const c = document.getElementById("eraseCanvas");
    const x = c.getContext("2d");
    const d = x.getImageData(0, 0, c.width, c.height);
    const pix = (ix, iy) => { const i = (iy * c.width + ix) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2]]; };
    const orig = document.createElement("canvas");
    orig.width = c.width; orig.height = c.height;
    const octx = orig.getContext("2d");
    const img = new Image();
    return new Promise((resolve) => {
      img.onload = () => {
        octx.drawImage(img, 0, 0, c.width, c.height);
        const od = octx.getImageData(0, 0, c.width, c.height);
        // Di luar kedua kotak watermark (+margin 30): harus byte-identical.
        // Kotak: badge (24..168,544..576), sparkle (716..768,519..571).
        const inMask = (xx, yy) => (xx >= -6 && xx <= 198 && yy >= 514) || (xx >= 686 && yy >= 489);
        let outsideBad = 0, outsideN = 0;
        for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) {
          if (inMask(xx, yy)) continue;
          const i = (yy * c.width + xx) * 4;
          let same = true;
          for (let ch = 0; ch < 3; ch++) if (d.data[i + ch] !== od.data[i + ch]) same = false;
          outsideN++;
          if (!same) outsideBad++;
        }
        resolve({
          sparkleCenter: pix(742, 545), // dulu putih (255,255,255)
          badgeWhite: pix(30, 560), // dulu putih (255,255,255)
          badgeText: pix(60, 558), // dulu gelap (30,30,30)
          outsideBad, outsideN,
        });
      };
      img.onerror = () => resolve({ error: "img load failed" });
      img.src = imgDataUrl;
    });
  }, IMG_DATA_URL);
  note("afterInstant", after);

  // Unduh hasil -> file valid.
  const dl = page.waitForEvent("download", { timeout: 30000 });
  await page.click("#eraseDownload");
  const download = await dl;
  const dlPath = "/tmp/wm-downloaded" + (download.suggestedFilename().endsWith(".png") ? ".png" : ".bin");
  await download.saveAs(dlPath);
  const buf = readFileSync(dlPath);
  note("downloadFile", download.suggestedFilename() + " " + buf.length + " bytes, magic=" + buf.subarray(0, 8).toString("hex"));

  // Simpan hasil -> kartu harus update "Watermark dihapus".
  await page.click("#eraseSave");
  await page.waitForTimeout(800);
  const cardText = await page.locator("#list").textContent();
  note("cardMentionsWatermark", /Watermark dihapus/.test(cardText));
  note("editorClosedAfterSave", await page.evaluate(() => document.getElementById("eraseModal").classList.contains("hidden")));
  // Buka Hapus Objek sesudah Watermark: judul harus balik "Hapus Objek".
  await page.click('button[data-act="erase"]');
  await page.waitForSelector("#eraseModal:not(.hidden)", { timeout: 10000 });
  note("titleBackToErase", await page.evaluate(() => document.getElementById("eraseTitle").textContent));
  await page.click("#eraseClose");

  note("modelReqsTotal", modelReqs().length === 0 ? "NONE (good)" : modelReqs());
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
note("allReqsTail", reqs.filter((u) => !u.startsWith("https://127.0.0.1")).slice(0, 20));

// Foto TANPA watermark + viewport 390px: deteksi harus bilang tidak ketemu,
// overlay kosong, tanpa overflow horizontal, 0 console error.
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
const p2 = await ctx2.newPage();
const errs2 = [];
p2.on("console", (m) => { if (m.type() === "error") errs2.push(m.text()); });
p2.on("pageerror", (e) => errs2.push(String(e)));
await p2.goto(BASE, { waitUntil: "networkidle" });
await p2.waitForTimeout(1000);
const overflow = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
note("overflow390", overflow);
await p2.click('[data-tool="clean"]');
await p2.waitForTimeout(500);
await p2.setInputFiles("#fileInput", CLEAN_IMG);
await p2.waitForSelector('button[data-act="save"]:not(.hidden)', { timeout: 30000 });
await p2.click('button[data-act="watermark"]');
await p2.waitForSelector("#eraseModal:not(.hidden)", { timeout: 10000 });
await p2.waitForTimeout(600);
note("cleanNote", await p2.locator("#eraseNote").textContent());
const ovClean = await p2.evaluate(() => {
  const c = document.getElementById("eraseOverlay");
  const x = c.getContext("2d");
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let total = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 120 && d[i + 2] < 120 && d[i + 3] > 50) total++;
  return { total, w: c.width, h: c.height };
});
note("overlayClean", ovClean);
const overflow2 = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, modalSw: document.getElementById("eraseModal").scrollWidth }));
note("overflow390Editor", overflow2);
note("consoleErrors390", errs2.slice(0, 10));

await browser.close();
server.kill();
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
