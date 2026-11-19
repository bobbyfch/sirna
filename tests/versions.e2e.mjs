// Langkah 3: rantai Bersihkan -> Objek -> Watermark pada satu file +
// tumpukan versi (kembali ke Asli/Bersih tanpa kehilangan versi baru) +
// rel alat + "Mulai dari file asli" + Simpan/preview memakai versi aktif.
// File 1: png-text.png (berlabel). File 2: wm-test.png (lingkaran merah
// + sparkle + badge "Made with AI" — buat cek piksel per versi).
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const F = (p) => new URL("./fixtures/" + p, import.meta.url).pathname;
const OUT = "/tmp/versions-e2e-result.json";
const log = [];
function note(k, v) { log.push([k, v]); console.log("##", k, "=", typeof v === "string" ? v : JSON.stringify(v)); }

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
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

async function cardInfo(nth) {
  return await page.evaluate((n) => {
    const c = document.querySelectorAll("#list article")[n];
    if (!c) return null;
    const versions = c.querySelector(".version-row");
    return {
      pill: c.querySelector(".status-pill")?.textContent?.trim(),
      versions: versions?.classList.contains("hidden") ? "(hidden)" : versions?.textContent?.replace(/\s+/g, " ").trim(),
      activeVersion: versions?.querySelector(".version-chip.active")?.textContent?.trim(),
      rail: c.querySelector(".tool-rail")?.textContent?.replace(/\s+/g, " ").trim(),
      saveHidden: c.querySelector('button[data-act="save"]')?.classList.contains("hidden"),
      resultHead: c.querySelector(".clean-head, .detect-head")?.textContent?.trim(),
    };
  }, nth);
}
async function previewPixel(nth, ix, iy) {
  await page.locator("#list article").nth(nth).locator(".thumb-wrap img").click();
  await page.waitForFunction(() => { const m = document.querySelector("#previewModal:not(.hidden) #previewBody img"); return !!m; }, { timeout: 10000 });
  // Tunggu gambar preview benar-benar ter-decode sebelum disampel —
  // kalau tidak, drawImage menggambar kanvas kosong (piksel [0,0,0]).
  await page.waitForFunction(() => { const img = document.querySelector("#previewBody img"); return img && img.complete && img.naturalWidth > 0; }, { timeout: 10000 });
  const px = await page.evaluate(([x, y]) => {
    const img = document.querySelector("#previewBody img");
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [ix, iy]);
  await page.click("#previewClose");
  await page.waitForTimeout(300);
  return px;
}
async function paintCircle() {
  const box = await page.locator("#eraseCanvas").boundingBox();
  const toPx = (ix, iy) => ({ x: box.x + (ix / 800) * box.width, y: box.y + (iy / 600) * box.height });
  for (const y of [250, 270, 290, 310, 330, 350]) {
    const a = toPx(335, y), b = toPx(465, y);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y, { steps: 2 });
    await page.mouse.up(); await page.waitForTimeout(80);
  }
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.click('[data-tool="clean"]');
  await page.waitForTimeout(600);
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png"), F("wm-test.png")]);
  await page.waitForFunction(() => document.querySelectorAll('button[data-act="save"]:not(.hidden)').length >= 2, { timeout: 60000 });
  await page.waitForTimeout(500);

  // (1) File 1: versi Asli·Bersih, rel alat Bersihkan ✓.
  note("f1_afterClean", await cardInfo(0));
  // (2) Kembali ke Asli -> pill "Ada label AI", Simpan sembunyi, toast C6.
  await page.locator("#list article").nth(0).locator('button[data-act="version"][data-v="Asli"]').click();
  await page.waitForTimeout(400);
  note("f1_backAsli", await cardInfo(0));
  note("f1_backAsliToast", await page.locator("#toast").textContent());
  // (3) Kembali ke Bersih -> "Sudah bersih" lagi, Simpan tampil.
  await page.locator("#list article").nth(0).locator('button[data-act="version"][data-v="Bersih"]').click();
  await page.waitForTimeout(400);
  note("f1_backBersih", await cardInfo(0));

  // (4) File 2: Hapus Objek via rel alat -> coret lingkaran -> Instan -> Simpan hasil.
  // Catatan: waitForSelector('#eraseModal:not(.hidden)') TIDAK bisa
  // diandalkan di halaman ini — timeout padahal modal sudah terbuka &
  // visible (diverifikasi via classList + bounding rect 1280x900 flex);
  // pakai waitForFunction di semua penunggu modal di tes ini.
  await page.locator("#list article").nth(1).locator('button[data-act="erase"]').click();
  await page.waitForFunction(() => !document.getElementById("eraseModal").classList.contains("hidden"), { timeout: 10000 });
  await paintCircle();
  await page.click("#eraseRun");
  await page.waitForFunction(() => !document.getElementById("eraseResultBar").classList.contains("hidden"), { timeout: 60000 });
  await page.click("#eraseSave");
  await page.waitForFunction(() => document.getElementById("eraseModal").classList.contains("hidden"), { timeout: 10000 });
  await page.waitForTimeout(500);
  note("f2_afterObjek", await cardInfo(1));
  // (5) Preview per versi: Bersih = lingkaran merah utuh; Objek = lingkaran hilang.
  await page.locator("#list article").nth(1).locator('button[data-act="version"][data-v="Bersih"]').click();
  await page.waitForTimeout(400);
  note("f2_previewBersih_circle", await previewPixel(1, 400, 300));
  await page.locator("#list article").nth(1).locator('button[data-act="version"][data-v="Objek"]').click();
  await page.waitForTimeout(400);
  note("f2_previewObjek_circle", await previewPixel(1, 400, 300));

  // (6) File 2: Hapus Watermark via rel alat -> deteksi otomatis -> Instan -> Simpan hasil.
  await page.locator("#list article").nth(1).locator('button[data-act="watermark"]').click();
  await page.waitForFunction(() => !document.getElementById("eraseModal").classList.contains("hidden"), { timeout: 10000 });
  await page.waitForTimeout(800);
  note("f2_wmOverlay", await page.evaluate(() => {
    const o = document.getElementById("eraseOverlay");
    const d = o.getContext("2d").getImageData(0, 0, o.width, o.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  }));
  await page.click("#eraseRun");
  await page.waitForFunction(() => !document.getElementById("eraseResultBar").classList.contains("hidden"), { timeout: 60000 });
  await page.click("#eraseSave");
  await page.waitForFunction(() => document.getElementById("eraseModal").classList.contains("hidden"), { timeout: 10000 });
  await page.waitForTimeout(500);
  note("f2_afterWatermark", await cardInfo(1));
  // (7) Preview per versi: Bersih = badge putih utuh; Watermark = badge hilang.
  await page.locator("#list article").nth(1).locator('button[data-act="version"][data-v="Bersih"]').click();
  await page.waitForTimeout(400);
  note("f2_previewBersih_badge", await previewPixel(1, 30, 560));
  await page.locator("#list article").nth(1).locator('button[data-act="version"][data-v="Watermark"]').click();
  await page.waitForTimeout(400);
  note("f2_previewWatermark_badge", await previewPixel(1, 30, 560));

  // (8) "Mulai dari file asli" (file 1): tombol tampil (sumber = hasil
  // Bersihkan) -> klik -> editor buka ulang dari asli -> tombol hilang.
  await page.locator("#list article").nth(0).locator('button[data-act="erase"]').click();
  await page.waitForFunction(() => !document.getElementById("eraseModal").classList.contains("hidden"), { timeout: 10000 });
  note("f1_origBtnVisible", await page.evaluate(() => !document.getElementById("eraseUseOriginal").classList.contains("hidden")));
  await page.click("#eraseUseOriginal");
  await page.waitForFunction(() => !document.getElementById("eraseModal").classList.contains("hidden") && document.getElementById("eraseUseOriginal").classList.contains("hidden"), { timeout: 10000 });
  note("f1_origBtnHiddenAfter", true);
  await page.click("#eraseClose");
  await page.waitForTimeout(400);

  // (9) Segmen Bersihkan di rel = pindah workspace ke Bersihkan.
  await page.click('[data-tool-switch="erase"]');
  await page.waitForTimeout(500);
  await page.locator("#list article").nth(0).locator('button[data-act="railclean"]').click();
  await page.waitForTimeout(500);
  note("railcleanSwitches", await page.evaluate(() => document.querySelector('[data-tool-switch="clean"]').classList.contains("active")));
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
await browser.close();
server.kill();
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
