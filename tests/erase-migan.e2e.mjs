// MI-GAN di browser, model asli via route interception.
// Alasan: Chromium di VM ini TIDAK BISA keluar internet sama sekali
// (probe: example.com pun ERR_TUNNEL_CONNECTION_FAILED; curl/Node jalan).
// Jadi transport HF diganti lokal, tapi byte modelnya ASLI (file yang sama
// yang diunduh dari HF & diverifikasi di Node) — yang diuji: progress bar,
// Cache Storage, onnxruntime-web (wasm EP), inferensi, composite-back.
// Transport HF sendiri sudah terbukti hidup: 302 + ACAO:* + 27 MB via curl.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // sertifikat self-signed server tes lokal
const TEST_IMG = "/tmp/erase-test.png";
const MODEL = "/tmp/models/migan_pipeline_v2.onnx";
// Bunuh server tes nyasar dari run yang crash sebelumnya (kalau tidak,
// spawn baru gagal EADDRINUSE tapi readiness poll tetap kena server lama).
try { execSync("pkill -f 'serve-sirn[a].mjs'"); await new Promise((r) => setTimeout(r, 500)); } catch (_e) {}
const server = spawn("node", ["/tmp/serve-sirna.mjs", "/home/hatch/workspace/sirna-vite/dist", "4173"], { stdio: "pipe" });
for (let i = 0; i < 20; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch (_e) {} await new Promise((r) => setTimeout(r, 500)); }

const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errs = [], pageErrs = [], reqs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => pageErrs.push(String(e)));
page.on("request", (r) => reqs.push(r.url()));
let hfHits = 0;
// ctx.route (bukan page.route): SW ikut mencegat fetch model, dan fetch
// dari dalam SW cuma bisa dicegat di level context.
await ctx.route("**/huggingface.co/**", async (route) => {
  hfHits++;
  // continue (bukan fulfill): body besar lewat CDP base64 bisa matiin target.
  await route.continue({ url: BASE + "model/migan_pipeline_v2.onnx" });
});
try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  console.log("## isolated =", await page.evaluate(() => self.crossOriginIsolated));
  await page.setInputFiles("#fileInput", TEST_IMG);
  await page.waitForSelector('button[data-act="save"]:not(.hidden)', { timeout: 30000 });
  await page.click('button[data-act="erase"]');
  await page.waitForSelector("#eraseModal:not(.hidden)", { timeout: 10000 });
  await page.click('[data-erase-mode="migan"]');
  await page.waitForTimeout(500);
  console.log("## modelBar =", await page.evaluate(() => document.getElementById("eraseModelLabel").textContent + " | " + document.getElementById("eraseModelState").textContent));
  // Tutup seluruh kotak hijau.
  const box = await page.locator("#eraseCanvas").boundingBox();
  const toPx = (ix, iy) => ({ x: box.x + (ix / 800) * box.width, y: box.y + (iy / 600) * box.height });
  for (const y of [430, 450, 470, 490]) {
    const a = toPx(55, y), b = toPx(205, y);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y, { steps: 2 });
    await page.mouse.up(); await page.waitForTimeout(120);
  }
  const t0 = Date.now();
  await page.click("#eraseRun");
  // Progress bar harus gerak selama unduh model.
  await page.waitForFunction(() => {
    const w = document.getElementById("eraseModelFill").style.width;
    return w && parseFloat(w) > 0;
  }, { timeout: 30000 });
  console.log("## progressSeen = true, hfHits =", hfHits);
  await page.waitForSelector("#eraseResultBar:not(.hidden)", { timeout: 180000 });
  console.log("## miganMs =", Date.now() - t0, "| note =", await page.locator("#eraseNote").textContent());
  const after = await page.evaluate(() => {
    const c = document.getElementById("eraseCanvas");
    const x = c.getContext("2d");
    const d = x.getImageData(0, 0, c.width, c.height);
    const pix = (ix, iy) => { const i = (iy * c.width + ix) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2]]; };
    const boxPts = [[80, 440], [130, 460], [180, 480], [100, 490], [160, 435]].map(([a, b]) => pix(a, b));
    const stillGreen = boxPts.filter(([r, g, b]) => g > 150 && r < 80 && b < 100).length;
    return { boxPts, stillGreen, corner: pix(10, 10), redCenter: pix(400, 300) };
  });
  console.log("## afterMigan =", JSON.stringify(after));
  // Cache: model harus tersimpan; run kedua tidak boleh fetch ulang.
  const cached = await page.evaluate(async () => {
    const c = await caches.open("sirna-models-v1");
    const hit = await c.match("https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx");
    return hit ? (await hit.arrayBuffer()).byteLength : 0;
  });
  console.log("## cachedBytes =", cached, "| hfHits =", hfHits);
  const ortReqs = reqs.filter((u) => /ort-wasm|ort\.wasm/i.test(u));
  console.log("## ortReqs =", JSON.stringify(ortReqs));
  // Unduh hasil -> file valid (PNG magic).
  const dl = page.waitForEvent("download", { timeout: 30000 });
  await page.click("#eraseDownload");
  const download = await dl;
  const dlPath = "/tmp/erase-migan-downloaded.png";
  await download.saveAs(dlPath);
  const buf = readFileSync(dlPath);
  console.log("## downloadFile =", download.suggestedFilename(), buf.length, "bytes, magic =", buf.subarray(0, 8).toString("hex"));
  // Simpan hasil -> kartu update.
  await page.click("#eraseSave");
  await page.waitForTimeout(800);
  console.log("## cardMentionsErase =", /Objek dihapus/.test(await page.locator("#list").textContent()));
  // Buka lagi: mode Cepat AI harus langsung "Tersimpan di HP" (cache) & tanpa fetch ulang.
  await page.click('button[data-act="erase"]');
  await page.waitForSelector("#eraseModal:not(.hidden)", { timeout: 10000 });
  console.log("## reopenCachedState =", await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 600));
    document.querySelector('[data-erase-mode="migan"]').click();
    await new Promise((r) => setTimeout(r, 600));
    return document.getElementById("eraseModelState").textContent;
  }), "| hfHits =", hfHits);
  await page.click("#eraseClose");
} catch (e) {
  console.log("## ERROR =", String(e && e.stack || e));
}
console.log("## consoleErrors =", JSON.stringify(errs.slice(0, 8)));
console.log("## pageErrors =", JSON.stringify(pageErrs.slice(0, 8)));
await browser.close();
server.kill();
console.log("DONE");
