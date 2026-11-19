// Smoke state machine Langkah 1 (§4.3) pivot: A1 pill/kotak awal, A4
// hasil, A7 WebM, A8 video tak bisa dibuang, no-op video bersih, A6
// file korup + tombol [Coba lagi]. Shell editor = satu-satunya tampilan
// state (daftar kartu file DIHAPUS pivot) — state dibaca dari
// #shellPill / #shellDetect / #shellResult file terpilih (filmstrip).
// Fixture: tests/fixtures/smoke/ + tests/fixtures/matrix/png-text.png
// + tests/fixtures/smoke/png-big.png.
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

async function selectFile(nth) {
  const id = await page.evaluate((n) => document.querySelectorAll("#shellFilm button")[n]?.dataset.shellId, nth);
  if (id === undefined || id === null) return false;
  await page.click(`#shellFilm button[data-shell-id="${id}"]`);
  await page.waitForTimeout(300);
  return true;
}
// State file terpilih di shell editor.
async function shellState() {
  return await page.evaluate(() => {
    return {
      pill: document.getElementById("shellPill")?.textContent?.trim(),
      detectHead: document.querySelector("#shellDetect .detect-head")?.textContent?.trim() || "",
      detectBody: document.querySelector("#shellDetect .clean-body")?.textContent?.trim() || "",
      resultHead: document.querySelector("#shellResult .clean-head, #shellResult .detect-head")?.textContent?.trim() || "",
      resultBody: document.querySelector("#shellResult .clean-body")?.textContent?.trim() || document.querySelector("#shellResult .error-box")?.textContent?.trim() || "",
      deepBtnLabel: document.querySelector('#shellResult button[data-act="deepclean"]')?.textContent?.trim() || "",
      hasRetryBtn: !!document.querySelector('#shellResult button[data-act="reclean"]'),
      toolStatus: document.getElementById("toolStatus")?.textContent?.trim() || "",
    };
  });
}
// Tunggu tombol utama jadi "Simpan foto" (1 file) / "Simpan semua (n)".
async function waitSave(n, timeout = 60000) {
  await page.waitForFunction((k) => {
    const b = document.getElementById("primaryBtn");
    if (!b || b.classList.contains("hidden")) return false;
    return k >= 2 ? b.textContent.includes("Simpan semua (" + k + ")") : b.textContent.includes("Simpan foto");
  }, n, { timeout });
}
async function restart() {
  // File-first: Mulai ulang -> home (antrean kosong); upload berikutnya
  // langsung membuka editor + auto-clean, tanpa pilih alat lagi.
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  await page.click("#sheetConfirm"); // konfirmasi sheet (Phase 2)
  await page.waitForTimeout(600);
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // (Langkah 2) Pengaturan tinggal di workspace Bersihkan — file-first:
  // upload 1 file dulu (editor terbuka), nyalakan Deep Clean, lalu
  // Mulai ulang. deepClean bertahan di memori (variabel modul), jadi
  // batch berikutnya tetap lewat jalur canvas yang lambat.
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await waitSave(1, 60000);
  await page.waitForTimeout(400);
  await page.click('[data-mode="deep"]');
  await page.waitForTimeout(300);
  await restart();

  // (A1) Deep Clean ON (jalur canvas, file besar lambat) -> upload 2 file:
  // file ke-2 harus sempat tampil "Ada label AI" + kotak "Label AI ketemu"
  // selagi file ke-1 masih dibersihkan (batch jalan berurutan).
  // Deep sudah ON dari warm-up di atas & bertahan melewati restart
  // (variabel modul, restart tidak me-reset) — tidak ada klik ulang:
  // pengaturan cuma ada di editor, di home tombolnya tersembunyi.
  await page.setInputFiles("#fileInput", [F("smoke/png-big.png"), F("matrix/png-text.png")]);
  let seen = null;
  for (let i = 0; i < 100; i++) {
    await selectFile(1);
    const s = await shellState();
    if (s && s.pill) { seen = s; if (s.pill === "Ada label AI") break; }
    await page.waitForTimeout(50);
  }
  note("A1_initialPill", seen?.pill);
  note("A1_detectHead", seen?.detectHead);
  note("A1_detectBody", seen?.detectBody);
  await waitSave(2, 120000);
  await page.waitForTimeout(400);
  await selectFile(0);
  const s0 = await shellState();
  await selectFile(1);
  const s1 = await shellState();
  note("A4_file0", { pill: s0?.pill, head: s0?.resultHead, body: s0?.resultBody });
  note("A4_file1", { pill: s1?.pill, head: s1?.resultHead, body: s1?.resultBody });
  note("A4_toolStatus", s1?.toolStatus);
  note("A4_toast", await page.locator("#toast").textContent());

  // Reset (Mulai ulang) -> (A7) WebM.
  await restart();
  await page.setInputFiles("#fileInput", [F("smoke/test.webm")]);
  await page.waitForFunction(() => {
    const p = document.getElementById("shellPill");
    return p && p.textContent.trim() !== "Lagi dibersihin…";
  }, { timeout: 30000 });
  await page.waitForTimeout(400);
  const w = await shellState();
  note("A7_webm", { pill: w?.pill, body: w?.resultBody });

  // (A8) MP4 label di mdat -> ketemu tapi tak bisa dibuang.
  await restart();
  await page.setInputFiles("#fileInput", [F("smoke/mp4-label-mdat.mp4")]);
  await page.waitForFunction(() => {
    const p = document.getElementById("shellPill");
    return p && p.textContent.trim() !== "Lagi dibersihin…";
  }, { timeout: 30000 });
  await page.waitForTimeout(400);
  const v8 = await shellState();
  note("A8_mp4label", { pill: v8?.pill, body: v8?.resultBody });

  // no-op: MP4 bersih tanpa box metadata -> "Sudah bersih", ukuran tetap.
  await restart();
  await page.setInputFiles("#fileInput", [F("smoke/mp4-clean.mp4")]);
  await waitSave(1, 30000);
  await page.waitForTimeout(400);
  const vc = await shellState();
  note("VID_clean", { pill: vc?.pill, head: vc?.resultHead, body: vc?.resultBody });

  // (A6) file korup -> "Gagal" + alasan + "File aslimu aman" + [Coba lagi].
  await restart();
  await page.setInputFiles("#fileInput", [F("smoke/corrupt.png")]);
  await page.waitForFunction(() => {
    const p = document.getElementById("shellPill");
    return p && p.textContent.trim() === "Gagal";
  }, { timeout: 30000 });
  await page.waitForTimeout(400);
  const bad = await shellState();
  note("A6_corrupt", { pill: bad?.pill, body: bad?.resultBody, hasRetryBtn: bad?.hasRetryBtn });
  // Klik [Coba lagi] di kotak -> jalan lagi, tetap Gagal (file memang korup),
  // tanpa crash / tanpa error halaman.
  await page.click('#shellResult button[data-act="reclean"]');
  await page.waitForTimeout(1500);
  const bad2 = await shellState();
  note("A6_afterRetry", { pill: bad2?.pill });
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
