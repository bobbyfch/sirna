// LaMa ("Terbaik") di browser, model asli via route interception.
// Sama kayak tes MI-GAN: Chromium VM tidak bisa keluar internet, jadi
// transport HF diganti file lokal ASLI (/tmp/models/lama_fp32.onnx,
// 208.044.816 byte, diverifikasi di Node). Yang diuji: download 198 MB +
// progress, Cache Storage, sesi LaMa (input 512x512 float32), composite-back.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // sertifikat self-signed server tes lokal
const TEST_IMG = "/tmp/erase-test.png";
const MODEL = "/tmp/models/lama_fp32.onnx";
// Bunuh server tes nyasar dari run yang crash sebelumnya (kalau tidak,
// spawn baru gagal EADDRINUSE tapi readiness poll tetap kena server lama).
try { execSync("pkill -f 'serve-sirn[a].mjs'"); await new Promise((r) => setTimeout(r, 500)); } catch (_e) {}
const server = spawn("node", ["/tmp/serve-sirna.mjs", "/home/hatch/workspace/sirna-vite/dist", "4173"], { stdio: "pipe" });
for (let i = 0; i < 20; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch (_e) {} await new Promise((r) => setTimeout(r, 500)); }

const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors", "--js-flags=--max-old-space-size=4096"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errs = [], pageErrs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => pageErrs.push(String(e)));
page.on("crash", () => console.log("## PAGE CRASHED"));
const memTimer = setInterval(async () => {
  try {
    const m = await page.evaluate(() => { const pm = performance.memory; return pm ? Math.round(pm.usedJSHeapSize / 1048576) + " MB heap" : "n/a"; });
    const st = await page.evaluate(() => document.getElementById("eraseModelState")?.textContent || "");
    console.log("## tick:", m, "|", st);
  } catch (_e) { /* page gone */ }
}, 10000);
let hfHits = 0;
await ctx.route("**/huggingface.co/**", async (route) => {
  hfHits++;
  // continue (bukan fulfill): body 198 MB lewat CDP base64 bisa matiin target.
  await route.continue({ url: BASE + "model/lama_fp32.onnx" });
});
try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  console.log("## isolated =", await page.evaluate(() => self.crossOriginIsolated));
  await page.setInputFiles("#fileInput", TEST_IMG);
  await page.waitForSelector('button[data-act="save"]:not(.hidden)', { timeout: 30000 });
  await page.click('button[data-act="erase"]');
  await page.waitForSelector("#eraseModal:not(.hidden)", { timeout: 10000 });
  await page.click('[data-erase-mode="lama"]');
  await page.waitForTimeout(500);
  console.log("## modelBar =", await page.evaluate(() => document.getElementById("eraseModelLabel").textContent + " | " + document.getElementById("eraseModelState").textContent));
  // Tutup seluruh lingkaran merah.
  const box = await page.locator("#eraseCanvas").boundingBox();
  const toPx = (ix, iy) => ({ x: box.x + (ix / 800) * box.width, y: box.y + (iy / 600) * box.height });
  for (const y of [250, 270, 290, 310, 330, 350]) {
    const a = toPx(335, y), b = toPx(465, y);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y, { steps: 2 });
    await page.mouse.up(); await page.waitForTimeout(120);
  }
  const t0 = Date.now();
  await page.click("#eraseRun");
  await page.waitForFunction(() => {
    const w = document.getElementById("eraseModelFill").style.width;
    return w && parseFloat(w) > 0;
  }, { timeout: 60000 });
  console.log("## progressSeen = true, hfHits =", hfHits);
  await page.waitForSelector("#eraseResultBar:not(.hidden)", { timeout: 420000 });
  console.log("## lamaMs =", Date.now() - t0, "| note =", await page.locator("#eraseNote").textContent());
  const after = await page.evaluate(() => {
    const c = document.getElementById("eraseCanvas");
    const x = c.getContext("2d");
    const d = x.getImageData(0, 0, c.width, c.height);
    const pix = (ix, iy) => { const i = (iy * c.width + ix) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2]]; };
    const circlePts = [[400, 300], [380, 280], [420, 320], [370, 300], [430, 300]].map(([a, b]) => pix(a, b));
    const stillRed = circlePts.filter(([r, g, b]) => r > 200 && g < 80 && b < 80).length;
    return { circlePts, stillRed, corner: pix(10, 10), green: pix(130, 460) };
  });
  console.log("## afterLama =", JSON.stringify(after));
  const cached = await page.evaluate(async () => {
    const c = await caches.open("sirna-models-v1");
    const hit = await c.match("https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx");
    return hit ? (await hit.arrayBuffer()).byteLength : 0;
  });
  console.log("## cachedBytes =", cached, "| hfHits =", hfHits);
  await page.click("#eraseSave");
  await page.waitForTimeout(800);
  console.log("## cardMentionsErase =", /Objek dihapus/.test(await page.locator("#list").textContent()));
} catch (e) {
  console.log("## ERROR =", String(e && e.stack || e));
}
console.log("## consoleErrors =", JSON.stringify(errs.slice(0, 8)));
console.log("## pageErrors =", JSON.stringify(pageErrs.slice(0, 8)));
clearInterval(memTimer);
await browser.close();
server.kill();
console.log("DONE");
