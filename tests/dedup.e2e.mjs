// E2E Hapus Duplikat: Playwright Chromium, serve dist/ lokal.
// Langkah: 1) load awal = NOL request model; 2) pilih alat Hapus
// Duplikat, upload 4 file: erase-test.png 2x (identik), dedup-near.png
// (mirip — 2% piksel digeser +/-5), wm-test.png (beda); 3) [Cari
// duplikat] -> 1 grup berisi 3 (identik + mirip), wm-test TIDAK masuk
// grup; 4) ganti pilihan simpan -> label "Disimpan" pindah; 5) [Hapus
// yang lain] -> sisa 2 kartu (yang disimpan + wm-test), toast konfirmasi;
// 6) pindai ulang otomatis -> "Tidak ada duplikat"; 7) viewport 390px:
// tanpa overflow, 0 console error.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const IMG_A = new URL("./fixtures/erase-test.png", import.meta.url).pathname;
const IMG_NEAR = new URL("./fixtures/dedup-near.png", import.meta.url).pathname;
const IMG_B = new URL("./fixtures/wm-test.png", import.meta.url).pathname;
const OUT = "/tmp/dedup-e2e-result.json";
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

  await page.click('button[data-tool="dedup"]');
  await page.waitForSelector("#panel-cleaner:not(.hidden)", { timeout: 10000 });
  await page.setInputFiles("#fileInput", [IMG_A, IMG_A, IMG_NEAR, IMG_B]);
  await page.waitForFunction(() => document.querySelectorAll("#list .card").length === 4, { timeout: 30000 });
  // #dedupView ada di dalam #queueSection — baru kelihatan setelah file masuk.
  await page.waitForSelector("#dedupView:not(.hidden)", { timeout: 10000 });
  await page.waitForTimeout(500);
  note("cardsUploaded", await page.evaluate(() => document.querySelectorAll("#list .card").length));

  const t1 = Date.now();
  await page.click("#dedupScanBtn");
  await page.waitForSelector(".dedup-group", { timeout: 60000 });
  note("scanMs", Date.now() - t1);
  note("groupsFound", await page.evaluate(() => document.querySelectorAll(".dedup-group").length));
  note("groupSize", await page.evaluate(() => document.querySelectorAll(".dedup-group .dedup-item").length));
  const groupText = await page.locator(".dedup-group").first().textContent();
  note("groupText", groupText);
  note("groupHasNear", /dedup-near/.test(groupText));
  note("groupExcludesWm", !/wm-test/.test(groupText));
  // Default: entri pertama (paling awal diunggah) yang disimpan.
  // Yang disimpan = .dedup-item TANPA class to-remove (bukan class "kept").
  note("defaultKept", await page.evaluate(() => {
    const kept = document.querySelector(".dedup-group .dedup-item:not(.to-remove)");
    return kept ? kept.getAttribute("data-id") : null;
  }));

  // Ganti pilihan simpan ke entri ke-2 -> label pindah.
  await page.click(".dedup-group .dedup-item:nth-child(2)");
  await page.waitForTimeout(400);
  note("keptAfterSwitch", await page.evaluate(() => {
    const items = [...document.querySelectorAll(".dedup-group .dedup-item")];
    return items.map((el) => [el.getAttribute("data-id"), !el.classList.contains("to-remove")]);
  }));
  note("removeBtnLabel", await page.locator(".dedup-remove").first().textContent());

  // Hapus yang lain -> sisa 2 kartu; pindai ulang -> tidak ada duplikat.
  await page.click(".dedup-remove");
  await page.waitForFunction(() => document.querySelectorAll("#list .card").length === 2, { timeout: 10000 });
  await page.waitForTimeout(800);
  note("cardsAfterRemove", await page.evaluate(() => document.querySelectorAll("#list .card").length));
  note("groupsAfterRescan", await page.evaluate(() => document.querySelectorAll(".dedup-group").length));
  note("emptyAfterRescan", await page.evaluate(() => /Tidak ada duplikat/.test(document.getElementById("dedupGroups").textContent)));
  const cardText = await page.locator("#list").textContent();
  note("wmStillThere", /wm-test/.test(cardText));
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
await p2.click('button[data-tool="dedup"]');
await p2.setInputFiles("#fileInput", [IMG_A, IMG_A, IMG_NEAR]);
await p2.waitForFunction(() => document.querySelectorAll("#list .card").length === 3, { timeout: 30000 });
await p2.click("#dedupScanBtn");
await p2.waitForSelector(".dedup-group", { timeout: 60000 });
await p2.waitForTimeout(800);
const overflow2 = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
note("overflow390Dedup", overflow2);
note("consoleErrors390", errs2.slice(0, 10));

await browser.close();
server.kill();
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
