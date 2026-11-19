// Hapus Watermark v1 (tanpa editor kuas): upload dari home -> auto-clean
// dulu -> chip watermark -> status jujur; tanda BUKAN Gemini -> tanpa
// tawaran coret; tidak ketemu tanda -> status jujur; TANPA request model.
// 390px, tanpa overflow. File 1: wm-test.png (bintang
// putih gambar tangan + badge "Made with AI" — BUKAN sparkle Gemini).
// File 2: wm-clean.png (tidak ada tanda).
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const F = (p) => new URL("./fixtures/" + p, import.meta.url).pathname;
const OUT = "/tmp/watermark-e2e-result.json";
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
const page = await ctx.newPage();
const consoleErrors = [];
const pageErrors = [];
const modelReqs = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("request", (r) => { if (NO_MODEL_RE.test(r.url())) modelReqs.push(r.url()); });

async function shellResultText() {
  return await page.evaluate(() => document.getElementById("shellResult")?.textContent?.trim() || "");
}
async function waitWmStatus() {
  await page.waitForFunction(() => {
    const t = document.getElementById("shellResult")?.textContent || "";
    return t.includes("Tanda ketemu tapi bukan pola Gemini") || t.includes("Tidak ketemu tanda watermark") || t.includes("Sparkle Gemini dihapus");
  }, { timeout: 15000 });
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  note("eraseModalAbsentAtLoad", await page.evaluate(() => !document.getElementById("eraseModal")));

  // (1) wm-test.png: upload dari home -> auto-clean -> chip watermark ->
  // tanda palsu ketemu, BUKAN Gemini -> status jujur. Tombol utama tetap
  // tampil ("Simpan foto") karena hasil Bersihkan sudah ada.
  await page.setInputFiles("#fileInput", [F("wm-test.png")]);
  await page.waitForFunction(() => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, { timeout: 60000 });
  await page.click('[data-tool-switch="watermark"]');
  await waitWmStatus();
  note("fakeMarkResult", await shellResultText());
  note("fakeMarkPill", await page.evaluate(() => document.getElementById("shellPill")?.textContent?.trim()));
  note("fakeMarkNoWatermarkVersion", await page.evaluate(() => !document.querySelector('#shellVersions button[data-v="Watermark"]')));
  note("fakeMarkPrimaryVisible", await page.evaluate(() => document.getElementById("primaryBtn").classList.contains("hidden") ? "(hidden)" : document.getElementById("primaryBtn").textContent.trim()));
  note("fakeMarkToolStatus", await page.evaluate(() => document.getElementById("toolStatus")?.textContent?.trim()));
  note("overflow390_fake", await page.evaluate(() => document.documentElement.scrollWidth - 390));

  // (2) Mulai ulang -> wm-clean.png: tidak ketemu tanda -> status jujur.
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  await page.click("#sheetConfirm");
  await page.waitForTimeout(600);
  await page.setInputFiles("#fileInput", [F("wm-clean.png")]);
  await page.waitForFunction(() => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, { timeout: 60000 });
  await page.click('[data-tool-switch="watermark"]');
  await waitWmStatus();
  note("cleanResult", await shellResultText());
  note("cleanNoWatermarkVersion", await page.evaluate(() => !document.querySelector('#shellVersions button[data-v="Watermark"]')));
  note("cleanPrimaryVisible", await page.evaluate(() => document.getElementById("primaryBtn").classList.contains("hidden") ? "(hidden)" : document.getElementById("primaryBtn").textContent.trim()));
  note("overflow390_clean", await page.evaluate(() => document.documentElement.scrollWidth - 390));
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
