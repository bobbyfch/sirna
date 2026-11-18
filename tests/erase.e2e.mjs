// E2E Hapus Objek: Playwright Chromium, serve dist/ lokal.
// Langkah: 1) load awal = TANPA fetch model/ort; 2) upload foto tes, buka
// editor, coret lingkaran merah, Hapus (Instan) -> piksel luar mask harus
// byte-identical, dalam mask berubah; 3) mode Cepat AI (MI-GAN): unduh model
// 27 MB sekali, hasil sama; 4) Simpan hasil -> kartu update; Unduh -> file
// valid; 5) viewport 390px: tanpa overflow horizontal, 0 console error.
// LaMa (Terbaik, 198 MB) dicoba kalau waktu memungkinkan — kalau tidak,
// cukup verifikasi Node (sudah) + jalur kode yang sama dengan MI-GAN.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // sertifikat self-signed server tes lokal
const TEST_IMG = "/tmp/erase-test.png"; // 800x600: gradien (x,y,128) + lingkaran merah r=60 di (400,300) + kotak hijau (60..200,420..500)
const OUT = "/tmp/erase-e2e-result.json";
const log = [];
function note(k, v) { log.push([k, v]); console.log("##", k, "=", typeof v === "string" ? v : JSON.stringify(v)); }

const IMG_DATA_URL = "data:image/png;base64," + readFileSync(TEST_IMG).toString("base64");
// Bunuh server tes nyasar dari run yang crash sebelumnya (kalau tidak,
// spawn baru gagal EADDRINUSE tapi readiness poll tetap kena server lama).
try { execSync("pkill -f 'serve-sirn[a].mjs'"); await new Promise((r) => setTimeout(r, 500)); } catch (_e) {}
const server = spawn("node", ["/tmp/serve-sirna.mjs", "/home/hatch/workspace/sirna-vite/dist", "4173"], { stdio: "pipe" });
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
// Chromium di VM ini tidak bisa keluar internet (egress proxy nolak tunnel
// browser; curl/Node jalan). Model HF diganti file lokal ASLI (byte yang
// sama, diverifikasi di Node) via ctx.route — SW ikut dicegat di level ini.
// Transport HF sendiri terbukti hidup: 302 + ACAO:* + 27 MB via curl.
await ctx.route("**/huggingface.co/**", async (route) => {
  const u = route.request().url();
  const file = u.includes("lama_fp32") ? "lama_fp32.onnx" : "migan_pipeline_v2.onnx";
  // continue (bukan fulfill): body besar lewat CDP base64 bisa matiin target.
  await route.continue({ url: BASE + "model/" + file });
});
const page = await ctx.newPage();
const reqs = [];
const consoleErrors = [];
const pageErrors = [];
page.on("request", (r) => reqs.push(r.url()));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("requestfailed", (r) => note("REQ-FAILED", r.url() + " :: " + (r.failure()?.errorText || "")));

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  note("isolated", await page.evaluate(() => self.crossOriginIsolated));
  const initialModelReqs = reqs.filter((u) => /huggingface|onnxruntime|ort-wasm|migan|lama|\.onnx/i.test(u));
  note("modelReqsOnLoad", initialModelReqs.length === 0 ? "NONE (good)" : initialModelReqs);

  // Upload foto tes.
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
  const modeReqsBefore = reqs.filter((u) => /huggingface|\.onnx|ort-wasm/i.test(u)).length;
  note("modelReqsAfterOpen", modeReqsBefore); // buka editor saja belum boleh unduh model

  // Coret: TUTUP SELURUH lingkaran merah (bukan garis tipis — Telea ngisi
  // coretan dari piksel sekitarnya, jadi garis tipis di tengah objek besar
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

  // Hapus (mode Instan = default).
  await page.click("#eraseRun");
  await page.waitForSelector("#eraseResultBar:not(.hidden)", { timeout: 60000 });
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
        // (terisi gradien, bukan merah lagi). Luar = jarak > 112 dari pusat
        // (kuas 48 + dilasi mencapai ~107; di luar itu harus byte-identical).
        const sx = c.width / 800, sy = c.height / 600;
        let outsideBad = 0, outsideN = 0, insideChanged = 0, insideN = 0;
        for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) {
          const dx = (xx / sx) - 400, dy = (yy / sy) - 300;
          const dist = Math.hypot(dx, dy);
          const i = (yy * c.width + xx) * 4;
          let same = true;
          for (let ch = 0; ch < 3; ch++) if (d.data[i + ch] !== od.data[i + ch]) same = false;
          if (dist <= 58) { insideN++; if (!same) insideChanged++; }
          else if (dist > 112) { outsideN++; if (!same) outsideBad++; }
        }
        resolve({ w: c.width, h: c.height, center: pix(400, 300), corner: pix(10, 10), green: pix(130, 460), outsideBad, outsideN, insideChanged, insideN });
      };
      img.onerror = () => resolve({ error: "img load failed" });
      img.src = imgDataUrl;
    });
  }, IMG_DATA_URL);
  note("afterInstant", after);
  note("noteText", await page.locator("#eraseNote").textContent());

  // Simpan hasil -> kartu harus update (teks "Objek dihapus").
  await page.click("#eraseSave");
  await page.waitForTimeout(800);
  const cardText = await page.locator("#list").textContent();
  note("cardMentionsErase", /Objek dihapus/.test(cardText));
  note("editorClosedAfterSave", await page.evaluate(() => document.getElementById("eraseModal").classList.contains("hidden")));

  // Buka lagi, mode Cepat AI (MI-GAN): coret kotak hijau, Hapus.
  await page.click('button[data-act="erase"]');
  await page.waitForSelector("#eraseModal:not(.hidden)", { timeout: 10000 });
  await page.click('[data-erase-mode="migan"]');
  await page.waitForTimeout(800);
  const modelBar = await page.evaluate(() => ({
    label: document.getElementById("eraseModelLabel").textContent,
    state: document.getElementById("eraseModelState").textContent,
  }));
  note("miganModelBar", modelBar);
  const box2 = await page.locator("#eraseCanvas").boundingBox();
  const toPx2 = (ix, iy) => ({ x: box2.x + (ix / 800) * box2.width, y: box2.y + (iy / 600) * box2.height });
  async function paintLine2(x1, y1, x2, y2) {
    const a = toPx2(x1, y1), b = toPx2(x2, y2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
  // Tutup SELURUH kotak hijau (60..200, 420..500), bukan garis tipis.
  for (const y of [430, 450, 470, 490]) await paintLine2(55, y, 205, y);
  await page.waitForTimeout(300);
  const t0 = Date.now();
  await page.click("#eraseRun");
  await page.waitForSelector("#eraseResultBar:not(.hidden)", { timeout: 300000 });
  note("miganMs", Date.now() - t0);
  note("miganNote", await page.locator("#eraseNote").textContent());
  const miganReqs = reqs.filter((u) => /huggingface|migan|\.onnx|ort-wasm/i.test(u));
  note("miganReqs", miganReqs.slice(0, 6));
  const afterMigan = await page.evaluate(() => {
    const c = document.getElementById("eraseCanvas");
    const x = c.getContext("2d");
    const d = x.getImageData(0, 0, c.width, c.height);
    const pix = (ix, iy) => { const i = (iy * c.width + ix) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2]]; };
    const boxPts = [[80, 440], [130, 460], [180, 480], [100, 490], [160, 435]].map(([a, b]) => pix(a, b));
    const stillGreen = boxPts.filter(([r, g, b]) => g > 150 && r < 80 && b < 100).length;
    return { boxPts, stillGreen, corner: pix(10, 10) };
  });
  note("afterMigan", afterMigan);

  // Unduh hasil (download event) -> file valid.
  const dl = page.waitForEvent("download", { timeout: 30000 });
  await page.click("#eraseDownload");
  const download = await dl;
  const dlPath = "/tmp/erase-downloaded" + (download.suggestedFilename().endsWith(".png") ? ".png" : ".bin");
  await download.saveAs(dlPath);
  const buf = readFileSync(dlPath);
  note("downloadFile", download.suggestedFilename() + " " + buf.length + " bytes, magic=" + buf.subarray(0, 8).toString("hex"));
  await page.click("#eraseClose");
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
