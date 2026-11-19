// Langkah 3 pivot: rantai Bersihkan -> Watermark (reverse-alpha) pada
// satu file + tumpukan versi (kembali ke Asli/Bersih tanpa kehilangan
// versi baru) + Simpan/preview memakai versi aktif. File 1: png-text.png
// (berlabel). File 2: wm-gemini.png (sparkle Gemini asli — buat cek
// piksel per versi; v1 = sparkle saja, tanpa editor kuas).
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

// State file TERPILIH di shell editor (filmstrip = satu-satunya antrean).
async function shellInfo() {
  return await page.evaluate(() => {
    const versions = document.getElementById("shellVersions");
    return {
      pill: document.getElementById("shellPill")?.textContent?.trim(),
      versions: versions?.classList.contains("hidden") ? "(hidden)" : versions?.textContent?.replace(/\s+/g, " ").trim(),
      activeVersion: versions?.querySelector(".version-chip.active")?.textContent?.trim(),
      primaryText: document.getElementById("primaryBtn")?.textContent?.trim(),
      primaryVisible: !document.getElementById("primaryBtn").classList.contains("hidden"),
      resultHead: document.querySelector("#shellResult .clean-head, #shellResult .detect-head")?.textContent?.trim(),
      resultBody: document.querySelector("#shellResult .clean-body")?.textContent?.trim(),
    };
  });
}
// Pilih file ke-n (0-based) lewat filmstrip kepala editor.
async function selectFile(nth) {
  const id = await page.evaluate((n) => document.querySelectorAll("#shellFilm button")[n]?.dataset.shellId, nth);
  await page.click(`#shellFilm button[data-shell-id="${id}"]`);
  await page.waitForTimeout(300);
}
// Sampel piksel gambar yang SEDANG tampil di kanvas shell (versi aktif).
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
  // File-first: upload langsung dari home -> auto-clean (tanpa pilih alat).
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png"), F("wm-gemini.png")]);
  await page.waitForFunction(() => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan semua (2)");
  }, { timeout: 60000 });
  await page.waitForTimeout(500);

  // (1) File 1: versi Asli·Bersih.
  await selectFile(0);
  note("f1_afterClean", await shellInfo());
  // (2) Kembali ke Asli -> pill "Ada label AI", toast C6; hasil
  // Bersihkan tetap tersimpan (chip Bersih masih ada).
  await page.click('#shellVersions button[data-v="Asli"]');
  await page.waitForTimeout(400);
  note("f1_backAsli", await shellInfo());
  note("f1_backAsliToast", await page.locator("#toast").textContent());
  // (3) Kembali ke Bersih -> "Sudah bersih" lagi, Simpan tampil.
  await page.click('#shellVersions button[data-v="Bersih"]');
  await page.waitForTimeout(400);
  note("f1_backBersih", await shellInfo());

  // (4) File 2: pilih lewat filmstrip, Hapus Watermark via rail kepala
  // editor -> auto-run v1: sparkle Gemini terdeteksi (NCC) -> reverse-alpha
  // -> versi "Watermark" otomatis, TANPA modal kuas / tombol Hapus.
  await selectFile(1);
  await page.click('[data-tool-switch="watermark"]');
  await page.waitForFunction(() => {
    const t = document.getElementById("shellResult")?.textContent || "";
    return t.includes("Sparkle Gemini dihapus");
  }, { timeout: 15000 });
  note("f2_wmModalAbsent", await page.evaluate(() => !document.getElementById("eraseModal")));
  note("f2_wmResult", await page.locator("#shellResult").textContent());
  await page.waitForTimeout(500);
  note("f2_afterWatermark", await shellInfo());
  // (5) Piksel per versi di kanvas shell: Bersih = sparkle masih
  // menempel (terang); Watermark = sparkle hilang (pulih ke asli).
  await page.click('#shellVersions button[data-v="Bersih"]');
  await page.waitForTimeout(400);
  note("f2_pixelBersih_sparkle", await shellPixel(742, 545));
  await page.click('#shellVersions button[data-v="Watermark"]');
  await page.waitForTimeout(400);
  note("f2_pixelWatermark_sparkle", await shellPixel(742, 545));

  // (6) File 1 + watermark (v1): tidak ada sparkle -> status jujur
  // "Tidak ketemu tanda watermark"; versi tetap Asli·Bersih (tidak ada
  // chip Watermark baru). "Mulai dari file asli" tidak ada lagi — itu
  // fitur editor kuas yang dicabut per keputusan Bobby 17:24.
  await selectFile(0);
  await page.click('[data-tool-switch="watermark"]');
  await page.waitForFunction(() => {
    const t = document.getElementById("shellResult")?.textContent || "";
    return t.includes("Tidak ketemu tanda watermark") || t.includes("bukan pola Gemini");
  }, { timeout: 15000 });
  note("f1_wmResult", await page.locator("#shellResult").textContent());
  note("f1_versionsAfterWm", await shellInfo());
  await page.waitForTimeout(400);

  // (7) Chip Bersihkan di rail kepala editor = pindah workspace ke
  // Bersihkan (auto-run, prinsip A).
  await page.click('[data-tool-switch="clean"]');
  await page.waitForTimeout(500);
  note("toolBarCleanSwitches", await page.evaluate(() => document.querySelector('[data-tool-switch="clean"]').classList.contains("active")));
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
await browser.close();
server.kill();
if (log.some(([k]) => k === "ERROR")) process.exitCode = 1;
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
