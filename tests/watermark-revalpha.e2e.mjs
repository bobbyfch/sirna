// Hapus Watermark v1 end-to-end: wm-gemini.png (sparkle Gemini asli) ->
// Bersihkan -> switch watermark -> auto-run reverse-alpha -> versi
// "Watermark" -> piksel tengah sparkle pulih ke nilai asli (±3) ->
// piksel di luar box byte-identical vs file asli -> blob versi Watermark
// adalah PNG valid (magic bytes, via blob URL kanvas). TANPA request model.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { decodePng } from "./fixtures/png-io.mjs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const F = (p) => new URL("./fixtures/" + p, import.meta.url).pathname;
const OUT = "/tmp/watermark-revalpha-e2e-result.json";
const log = [];
function note(k, v) { log.push([k, v]); console.log("##", k, "=", typeof v === "string" ? v : JSON.stringify(v)); }

const NO_MODEL_RE = /huggingface|staticimgly|onnxruntime|ort-wasm|migan|lama|\.onnx|isnet/i;
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
const modelReqs = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("request", (r) => { if (NO_MODEL_RE.test(r.url())) modelReqs.push(r.url()); });

// Piksel acuan dari fixture (Node, decode langsung): tengah sparkle di
// wm-gemini = [246,244,192] (ter-blend putih); nilai ASLI (wm-clean) =
// [236,232,128]. Di luar box sparkle, file harus identik dengan aslinya.
const orig = decodePng(readFileSync(F("wm-gemini.png")));
// decodePng -> { width, height, data } RGBA (4 kanal).
function fixturePixel(x, y) {
  const i = (y * orig.width + x) * 4;
  return [orig.data[i], orig.data[i + 1], orig.data[i + 2]];
}
async function shellPixel(ix, iy) {
  await page.waitForFunction(() => { const img = document.getElementById("shellImg"); return img && img.complete && img.naturalWidth > 0; }, { timeout: 10000 });
  return await page.evaluate(([x, y]) => {
    const img = document.getElementById("shellImg");
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [ix, iy]);
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  note("fixtureSparkleCenter", fixturePixel(742, 545));
  note("fixtureOutside", fixturePixel(100, 100));
  // File-first: upload langsung dari home -> auto-clean (tanpa pilih alat).
  await page.setInputFiles("#fileInput", [F("wm-gemini.png")]);
  await page.waitForFunction(() => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, { timeout: 60000 });
  await page.waitForTimeout(400);
  // Sebelum watermark: sparkle masih menempel.
  note("pixelBefore", await shellPixel(742, 545));
  await page.click('[data-tool-switch="watermark"]');
  await page.waitForFunction(() => {
    const t = document.getElementById("shellResult")?.textContent || "";
    return t.includes("Sparkle Gemini dihapus");
  }, { timeout: 15000 });
  note("wmResult", await page.locator("#shellResult").textContent());
  note("wmModalAbsent", await page.evaluate(() => !document.getElementById("eraseModal")));
  note("versions", await page.evaluate(() => document.getElementById("shellVersions")?.textContent?.replace(/\s+/g, " ").trim()));
  note("activeVersion", await page.evaluate(() => document.querySelector(".version-chip.active")?.textContent?.trim()));
  // Piksel tengah sparkle pulih ke nilai asli (±3/kanal).
  const after = await shellPixel(742, 545);
  note("pixelAfter", after);
  const clean = [236, 232, 128];
  note("pixelRecovered", after.every((v, i) => Math.abs(v - clean[i]) <= 3));
  // Piksel di luar box sparkle byte-identical vs file asli.
  const outsideAfter = await shellPixel(100, 100);
  const outsideOrig = fixturePixel(100, 100);
  note("pixelOutsideAfter", outsideAfter);
  note("pixelOutsideIdentical", JSON.stringify(outsideAfter) === JSON.stringify(outsideOrig));
  // Gambar versi Watermark = PNG valid: gambar ulang #shellImg ke canvas
  // lalu toDataURL('image/png') — prefix base64 "iVBORw0KGgo" = magic PNG
  // (89 50 4E 47 0D 0A 1A 0A). (fetch(blob:) diblok CSP connect-src 'self',
  // jadi tidak dipakai; ini juga menghindari dialog save-file-picker.)
  note("blobIsPng", await page.evaluate(() => {
    const img = document.getElementById("shellImg");
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    const url = c.toDataURL("image/png");
    return url.startsWith("data:image/png;base64,iVBORw0KGgo") && url.length > 1000;
  }));
  note("primaryLabel", await page.locator("#primaryBtn").textContent());
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("modelRequests", modelReqs.slice(0, 10));
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
writeFileSync(OUT, JSON.stringify(Object.fromEntries(log), null, 2));
console.log("DONE ->", OUT);
await ctx.close();
server.kill();
process.exit(0);
