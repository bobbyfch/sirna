// E2E Hapus Objek: Playwright Chromium, serve dist/ lokal.
// Langkah: 1) load awal = NOL request model/runtime apa pun; 2) upload foto
// tes, buka editor, coret lingkaran merah, Hapus (Mi-GAN, SATU engine) ->
// piksel luar mask harus byte-identical, dalam mask berubah; 3) Unduh ->
// file valid; 4) Simpan hasil -> kartu update; 5) coret BESAR (>2% foto)
// -> peringatan mask muncul, TANPA tombol pindah mode AI (satu engine,
// tanpa tier); 6) viewport 390px: tanpa overflow horizontal, 0 console error.
// Single-engine (19 Nov 2026): model Mi-GAN 28,1 MB diunduh sekali saat
// Hapus ditekan (di-intercept Playwright -> fixture lokal, tanpa internet),
// tersimpan di Cache Storage; Telea cuma fallback offline (tidak diuji di sini).
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // sertifikat self-signed server tes lokal
const TEST_IMG = new URL("./fixtures/erase-test.png", import.meta.url).pathname; // 800x600: gradien (x,y,128) + lingkaran merah r=60 di (400,300) + kotak hijau (60..200,420..500)
const MIGAN_MODEL = new URL("./fixtures/models/migan_pipeline_v2.onnx", import.meta.url).pathname;
const OUT = "/tmp/erase-e2e-result.json";
const log = [];
function note(k, v) { log.push([k, v]); console.log("##", k, "=", typeof v === "string" ? v : JSON.stringify(v)); }

const IMG_DATA_URL = "data:image/png;base64," + readFileSync(TEST_IMG).toString("base64");
// Bunuh server tes nyasar dari run yang crash sebelumnya (kalau tidak,
// spawn baru gagal EADDRINUSE tapi readiness poll tetap kena server lama).
try { execSync("pkill -f 'serve-sirn[a].mjs'"); await new Promise((r) => setTimeout(r, 500)); } catch (_e) {}
const server = spawn("node", [new URL("./serve-sirna.mjs", import.meta.url).pathname, "/home/hatch/workspace/sirna-vite/dist", "4173"], { stdio: "pipe" });
// Tunggu server beneran jawab (bukan sleep buta).
for (let i = 0; i < 20; i++) {
  try { const r = await fetch(BASE); if (r.ok) break; } catch (_e) { /* belum */ }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"] });
// VM ini cuma bisa keluar internet lewat egress proxy (direct egress mati).
// Chromium headless nggak bisa jawab prompt auth proxy, jadi kredensial
// proxy dibaca dari env (bukan hardcode) dan dipasang di context Playwright.
// Proxy ini TIDAK dipakai buat 127.0.0.1 (bypass) — server lokal tetap direct.
let proxyOpt = undefined;
try {
  const pu = new URL(process.env.HTTPS_PROXY || process.env.https_proxy || "");
  if (pu.hostname) proxyOpt = { server: `${pu.protocol}//${pu.hostname}:${pu.port}`, username: decodeURIComponent(pu.username), password: decodeURIComponent(pu.password), bypass: "127.0.0.1,localhost" };
} catch (_e) { /* tanpa proxy */ }
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, serviceWorkers: "block", ...(proxyOpt ? { proxy: proxyOpt } : {}) });
// Chromium di VM ini tidak bisa keluar internet (egress proxy nolak tunnel
// browser; curl/Node jalan). Model HF di-intercept -> fixture lokal, jadi
// unduhan model tetap teruji end-to-end (fetch + SHA-256 + Cache Storage)
// tanpa internet. Service worker diblokir di context ini supaya tidak
// menghalangi intercept.
// Model = request ke huggingface.co (atau .onnx); runtime ORT wasm lokal
// (/ort/) dicatat terpisah — itu bukan unduhan model.
const MODEL_RE = /huggingface\.co|\.onnx/i;
const ORT_RE = /\/ort\//;
const modelReqs = () => reqs.filter((u) => MODEL_RE.test(u));
const ortReqs = () => reqs.filter((u) => ORT_RE.test(u));
const page = await ctx.newPage();
const reqs = [];
const consoleErrors = [];
const pageErrors = [];
page.on("request", (r) => reqs.push(r.url()));
// Intercept unduhan model: resolve HF -> fixture lokal (tanpa redirect).
let pendingModel = null;
await page.route("**/huggingface.co/**", async (route) => {
  const u = route.request().url();
  if (!u.includes("migan_pipeline_v2.onnx")) return route.abort();
  pendingModel = MIGAN_MODEL;
  return route.fulfill({ path: MIGAN_MODEL });
});
await page.route("**/cdn-lfs.huggingface.co/**", async (route) => {
  if (!pendingModel) return route.abort();
  return route.fulfill({ path: pendingModel });
});
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("requestfailed", (r) => note("REQ-FAILED", r.url() + " :: " + (r.failure()?.errorText || "")));

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  note("isolated", await page.evaluate(() => self.crossOriginIsolated));
  note("modelReqsOnLoad", modelReqs().length === 0 ? "NONE (good)" : modelReqs());

  // Upload foto tes — pilih Bersihkan dulu (tanpa alat, file cuma
  // diantre; arah 19 Nov 2026).
  await page.click('[data-tool="clean"]');
  await page.waitForTimeout(500);
  await page.setInputFiles("#fileInput", TEST_IMG);
  await page.waitForSelector('button[data-act="save"]:not(.hidden)', { timeout: 30000 });
  note("cleanDone", "save button visible");
  await page.waitForTimeout(500);

  // Buka editor Hapus Objek.
  await page.click('button[data-act="erase"]');
  await page.waitForSelector("#eraseModal:not(.hidden)", { timeout: 10000 });
  const modalVisible = await page.evaluate(() => !document.getElementById("eraseModal").classList.contains("hidden"));
  note("editorOpen", modalVisible);
  const canvasBox = await page.locator("#eraseCanvas").boundingBox();
  note("canvasBox", canvasBox);
  note("modelReqsAfterOpen", modelReqs().length); // buka editor tidak mengunduh apa pun

  // Coret: TUTUP SELURUH lingkaran merah (bukan garis tipis — inpainting
  // ngisi coretan dari piksel sekitarnya, jadi garis tipis di tengah objek besar
  // bakal keisi warna objeknya lagi. Itu perilaku benar, bukan bug).
  // 6 garis horizontal (y=250..350, spasi 20 < lebar kuas 48) menutup lingkaran.
  const toPx = (ix, iy) => ({ x: canvasBox.x + (ix / 800) * canvasBox.width, y: canvasBox.y + (iy / 600) * canvasBox.height });
  async function paintLine(x1, y1, x2, y2) {
    const a = toPx(x1, y1), b = toPx(x2, y2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
  for (const y of [250, 270, 290, 310, 330, 350]) await paintLine(335, y, 465, y);
  await page.waitForTimeout(300);

  // Snapshot piksel SEBELUM hapus (display canvas == gambar kerja asli).
  const before = await page.evaluate(() => {
    const c = document.getElementById("eraseCanvas");
    const x = c.getContext("2d");
    const d = x.getImageData(0, 0, c.width, c.height);
    const pix = (ix, iy) => { const i = (iy * c.width + ix) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2]]; };
    return { w: c.width, h: c.height, center: pix(400, 300), corner: pix(10, 10), green: pix(130, 460) };
  });
  note("beforePixels", before);

  // Hapus (Mi-GAN — model diunduh sekali saat ini; bar progres harus
  // sempat tampil). Poller progres dimulai SEBELUM klik.
  const progressSeen = page.waitForSelector("#eraseModelProgress:not(.hidden)", { timeout: 30000 }).then(() => true).catch(() => false);
  const tRun = Date.now();
  await page.click("#eraseRun");
  await page.waitForSelector("#eraseResultBar:not(.hidden)", { timeout: 180000 });
  note("runMs", Date.now() - tRun);
  note("progressBarSeen", await progressSeen);
  note("modelReqsAfterRun", modelReqs());
  note("modelReqCount", modelReqs().length); // harus 1: URL Mi-GAN ter-pin, sekali
  note("ortReqsAfterRun", ortReqs()); // wasm ORT lokal dari /ort/
  const after = await page.evaluate((imgDataUrl) => {
    const c = document.getElementById("eraseCanvas");
    const x = c.getContext("2d");
    const d = x.getImageData(0, 0, c.width, c.height);
    const pix = (ix, iy) => { const i = (iy * c.width + ix) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2]]; };
    // Bandingkan seluruh kanvas vs gambar asli yang digambar ulang di resolusi kerja.
    const orig = document.createElement("canvas");
    orig.width = c.width; orig.height = c.height;
    const octx = orig.getContext("2d");
    const img = new Image();
    return new Promise((resolve) => {
      img.onload = () => {
        octx.drawImage(img, 0, 0, c.width, c.height);
        const od = octx.getImageData(0, 0, c.width, c.height);
        // Dalam = isi lingkaran merah (jarak <= 58 dari pusat): harus berubah
        // (terisi gradien, bukan merah lagi). Luar = jarak > 130 dari pusat
        // (coretan kuas 48 mencapai dist 123,4 dari pusat — sudut persegi
        // coretan + round cap + dilasi 1; di luar itu harus byte-identical).
        const sx = c.width / 800, sy = c.height / 600;
        let outsideBad = 0, outsideN = 0, insideChanged = 0, insideN = 0;
        for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) {
          const dx = (xx / sx) - 400, dy = (yy / sy) - 300;
          const dist = Math.hypot(dx, dy);
          const i = (yy * c.width + xx) * 4;
          let same = true;
          for (let ch = 0; ch < 3; ch++) if (d.data[i + ch] !== od.data[i + ch]) same = false;
          if (dist <= 58) { insideN++; if (!same) insideChanged++; }
          else if (dist > 130) { outsideN++; if (!same) outsideBad++; }
        }
        resolve({ w: c.width, h: c.height, center: pix(400, 300), corner: pix(10, 10), green: pix(130, 460), outsideBad, outsideN, insideChanged, insideN });
      };
      img.onerror = () => resolve({ error: "img load failed" });
      img.src = imgDataUrl;
    });
  }, IMG_DATA_URL);
  note("afterInstant", after);
  note("noteText", await page.locator("#eraseNote").textContent());

  // Unduh hasil (download event) -> file valid.
  const dl = page.waitForEvent("download", { timeout: 30000 });
  await page.click("#eraseDownload");
  const download = await dl;
  const dlPath = "/tmp/erase-downloaded" + (download.suggestedFilename().endsWith(".png") ? ".png" : ".bin");
  await download.saveAs(dlPath);
  const buf = readFileSync(dlPath);
  note("downloadFile", download.suggestedFilename() + " " + buf.length + " bytes, magic=" + buf.subarray(0, 8).toString("hex"));

  // Simpan hasil -> kartu harus update (teks "Objek dihapus").
  await page.click("#eraseSave");
  await page.waitForTimeout(800);
  const cardText = await page.locator("#list").textContent();
  note("cardMentionsErase", /Objek dihapus/.test(cardText));
  note("editorClosedAfterSave", await page.evaluate(() => document.getElementById("eraseModal").classList.contains("hidden")));

  // Buka lagi, coret BESAR (>2% foto): peringatan mask muncul, TANPA
  // tombol pindah mode AI (revert: tidak ada lagi "Pakai Cepat AI").
  await page.click('button[data-act="erase"]');
  await page.waitForSelector("#eraseModal:not(.hidden)", { timeout: 10000 });
  const box3 = await page.locator("#eraseCanvas").boundingBox();
  const toPx3 = (ix, iy) => ({ x: box3.x + (ix / 800) * box3.width, y: box3.y + (iy / 600) * box3.height });
  async function paintLine3(x1, y1, x2, y2) {
    const a = toPx3(x1, y1), b = toPx3(x2, y2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
  for (const y of [150, 450]) await paintLine3(100, y, 700, y);
  await page.waitForTimeout(400);
  note("maskWarnVisible", await page.evaluate(() => !document.getElementById("eraseMaskWarn").classList.contains("hidden")));
  note("maskWarnText", await page.locator("#eraseMaskWarnText").textContent());
  note("noAiSwitchButton", await page.evaluate(() => document.getElementById("eraseWarnMigan") === null));
  note("noModeButtons", await page.evaluate(() => document.querySelectorAll("[data-erase-mode]").length));
  await page.click("#eraseClose");
  note("modelReqsTotal", modelReqs()); // tetap 1 (tidak ada unduhan model lain)
  note("modelReqCountTotal", modelReqs().length);
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
note("allReqsTail", reqs.filter((u) => !u.startsWith("http://127.0.0.1")).slice(0, 20));

// Viewport 390px: overflow horizontal + console error di halaman utama.
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
await p2.setInputFiles("#fileInput", TEST_IMG);
await p2.waitForSelector('button[data-act="save"]:not(.hidden)', { timeout: 30000 });
await p2.click('button[data-act="erase"]');
await p2.waitForSelector("#eraseModal:not(.hidden)", { timeout: 10000 });
await p2.waitForTimeout(800);
const overflow2 = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, modalSw: document.getElementById("eraseModal").scrollWidth }));
note("overflow390Editor", overflow2);
note("consoleErrors390", errs2.slice(0, 10));

await browser.close();
server.kill();
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
