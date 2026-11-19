// Smoke state machine Langkah 1 (§4.3): A1 pill/kotak awal, A4 hasil +
// stats/batch bar, A7 WebM, A8 video tak bisa dibuang, no-op video bersih,
// A6 file korup + tombol [Coba lagi]. Fixture: tests/fixtures/smoke/ +
// tests/fixtures/matrix/png-text.png + tests/fixtures/smoke/png-big.png.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const F = (p) => new URL("./fixtures/" + p, import.meta.url).pathname;
const OUT = "/tmp/statemachine-e2e-result.json";
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

async function cardState(nth) {
  return await page.evaluate((n) => {
    const c = document.querySelectorAll("#list article")[n];
    if (!c) return null;
    const id = c.id.replace("card-", "");
    return {
      name: c.querySelector("h4")?.textContent,
      pill: c.querySelector(".status-pill")?.textContent?.trim(),
      detectHead: c.querySelector("#detect-" + id + " .detect-head")?.textContent?.trim() || "",
      detectBody: c.querySelector("#detect-" + id + " .clean-body")?.textContent?.trim() || "",
      resultHead: c.querySelector("#result-" + id + " .clean-head, #result-" + id + " .detect-head")?.textContent?.trim() || "",
      resultBody: c.querySelector("#result-" + id + " .clean-body")?.textContent?.trim() || c.querySelector("#result-" + id + " .error-box")?.textContent?.trim() || "",
      deepBtnLabel: c.querySelector('button[data-act="deepclean"]')?.textContent?.trim() || "", // "Bersihkan dengan Deep" (prinsip K, dulu "Coba Deep Clean")
      hasRetryBtn: !!c.querySelector('button[data-act="reclean"]:not(.hidden)') && !!c.querySelector("#result-" + id + ' button[data-act="reclean"]'),
    };
  }, nth);
}
// Tunggu tombol utama jadi "Simpan foto" (1 file) / "Simpan semua (n)"
// — tombol Simpan per kartu sudah dihapus (prinsip C).
async function waitSave(n, timeout = 60000) {
  await page.waitForFunction((k) => {
    const b = document.getElementById("primaryBtn");
    if (!b || document.getElementById("primaryBar").classList.contains("hidden")) return false;
    return k >= 2 ? b.textContent.includes("Simpan semua (" + k + ")") : b.textContent.includes("Simpan foto");
  }, n, { timeout });
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // (Langkah 2) Pengaturan kini tinggal di workspace Bersihkan: pilih
  // alatnya dulu, baru atur Deep Clean.
  await page.click('[data-tool="clean"]');
  await page.waitForTimeout(600);

  // (A1) Deep Clean ON (jalur canvas, file besar lambat) -> upload 2 file:
  // kartu ke-2 harus sempat tampil "Ada label AI" + kotak "Label AI ketemu"
  // selagi kartu ke-1 masih dibersihkan (batch jalan berurutan).
  await page.click('[data-mode="deep"]');
  await page.setInputFiles("#fileInput", [F("smoke/png-big.png"), F("matrix/png-text.png")]);
  let seen = null;
  for (let i = 0; i < 100; i++) {
    const s = await cardState(1);
    if (s && s.pill) { seen = s; if (s.pill === "Ada label AI") break; }
    await page.waitForTimeout(50);
  }
  note("A1_initialPill", seen?.pill);
  note("A1_detectHead", seen?.detectHead);
  note("A1_detectBody", seen?.detectBody);
  await waitSave(2, 120000);
  await page.waitForTimeout(400);
  const s0 = await cardState(0), s1 = await cardState(1);
  note("A4_card0", { pill: s0?.pill, head: s0?.resultHead, body: s0?.resultBody });
  note("A4_card1", { pill: s1?.pill, head: s1?.resultHead, body: s1?.resultBody });
  note("A4_stats", await page.locator("#statsText").textContent());
  note("A4_batch", await page.locator("#batchStats").textContent());
  note("A4_batchVisible", await page.evaluate(() => !document.getElementById("batchBar").classList.contains("hidden")));
  note("A4_toast", await page.locator("#toast").textContent());

  // Reset (Mulai ulang) -> (A7) WebM.
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  await page.click("#sheetConfirm"); // konfirmasi sheet (Phase 2)
  await page.waitForTimeout(600);
  await page.click('[data-tool="clean"]'); // restart balik ke pemilih — pilih lagi
  await page.waitForTimeout(500);
  await page.setInputFiles("#fileInput", [F("smoke/test.webm")]);
  await page.waitForFunction(() => {
    const p = document.querySelector("#list article .status-pill");
    return p && p.textContent.trim() !== "Lagi dibersihin…";
  }, { timeout: 30000 });
  await page.waitForTimeout(400);
  const w = await cardState(0);
  note("A7_webm", { pill: w?.pill, body: w?.resultBody });

  // (A8) MP4 label di mdat -> ketemu tapi tak bisa dibuang.
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  await page.click("#sheetConfirm"); // konfirmasi sheet (Phase 2)
  await page.waitForTimeout(600);
  await page.click('[data-tool="clean"]'); // restart balik ke pemilih — pilih lagi
  await page.waitForTimeout(500);
  await page.setInputFiles("#fileInput", [F("smoke/mp4-label-mdat.mp4")]);
  await page.waitForFunction(() => {
    const p = document.querySelector("#list article .status-pill");
    return p && p.textContent.trim() !== "Lagi dibersihin…";
  }, { timeout: 30000 });
  await page.waitForTimeout(400);
  const v8 = await cardState(0);
  note("A8_mp4label", { pill: v8?.pill, body: v8?.resultBody });

  // no-op: MP4 bersih tanpa box metadata -> "Sudah bersih", ukuran tetap.
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  await page.click("#sheetConfirm"); // konfirmasi sheet (Phase 2)
  await page.waitForTimeout(600);
  await page.click('[data-tool="clean"]'); // restart balik ke pemilih — pilih lagi
  await page.waitForTimeout(500);
  await page.setInputFiles("#fileInput", [F("smoke/mp4-clean.mp4")]);
  await waitSave(1, 30000);
  await page.waitForTimeout(400);
  const vc = await cardState(0);
  note("VID_clean", { pill: vc?.pill, head: vc?.resultHead, body: vc?.resultBody });

  // (A6) file korup -> "Gagal" + alasan + "File aslimu aman" + [Coba lagi].
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  await page.click("#sheetConfirm"); // konfirmasi sheet (Phase 2)
  await page.waitForTimeout(600);
  await page.click('[data-tool="clean"]'); // restart balik ke pemilih — pilih lagi
  await page.waitForTimeout(500);
  await page.setInputFiles("#fileInput", [F("smoke/corrupt.png")]);
  await page.waitForFunction(() => {
    const p = document.querySelector("#list article .status-pill");
    return p && p.textContent.trim() === "Gagal";
  }, { timeout: 30000 });
  await page.waitForTimeout(400);
  const bad = await cardState(0);
  note("A6_corrupt", { pill: bad?.pill, body: bad?.resultBody, hasRetryBtn: bad?.hasRetryBtn });
  // Klik [Coba lagi] di kotak -> jalan lagi, tetap Gagal (file memang korup),
  // tanpa crash / tanpa error halaman.
  await page.click('#list article button[data-act="reclean"]');
  await page.waitForTimeout(1500);
  const bad2 = await cardState(0);
  note("A6_afterRetry", { pill: bad2?.pill });
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
await browser.close();
server.kill();
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
