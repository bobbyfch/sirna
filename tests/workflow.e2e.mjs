// Alur redesain (tool-first + auto-run): pemilih alat -> workspace
// Bersihkan -> upload -> alat jalan sendiri -> Sudah bersih -> ganti
// alat (file & hasil tetap, alat baru langsung jalan/buka editor) ->
// balik ke pemilih -> workspace Hapus Objek -> upload langsung buka
// editor (coretan = input). + 390px tanpa overflow, 0 error konsol.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const F = (p) => new URL("./fixtures/" + p, import.meta.url).pathname;
const OUT = "/tmp/workflow-e2e-result.json";
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
async function toolStatusText() {
  return await page.evaluate(() => document.getElementById("toolStatus")?.textContent?.trim() || "");
}
async function primaryText() {
  return await page.evaluate(() => document.getElementById("primaryBtn")?.textContent?.trim() || "");
}
async function primaryVisible() {
  return await page.evaluate(() => !document.getElementById("primaryBtn").classList.contains("hidden"));
}
async function cardPill(nth) {
  return await page.evaluate((n) => document.querySelectorAll("#list article .status-pill")[n]?.textContent?.trim(), nth);
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  // (1) Layar A: pemilih alat kelihatan, workspace sembunyi.
  note("pickerVisible", await page.evaluate(() => !document.getElementById("heroSection").classList.contains("hidden")));
  note("pickerCards", await page.evaluate(() => Array.from(document.querySelectorAll("#toolPicker .tool-card")).map((c) => c.dataset.tool).filter(Boolean).join(",")));
  note("panelHidden", await page.evaluate(() => document.getElementById("panel-cleaner").classList.contains("hidden")));
  // (2) Pilih Bersihkan -> workspace muncul, baris status, pengaturan tampil.
  await page.click('[data-tool="clean"]');
  await page.waitForTimeout(600);
  note("panelVisible", await page.evaluate(() => !document.getElementById("panel-cleaner").classList.contains("hidden")));
  note("heroHidden", await page.evaluate(() => document.getElementById("heroSection").classList.contains("hidden")));
  note("toolStatusClean", await toolStatusText());
  note("settingsVisible", await page.evaluate(() => !document.getElementById("settingsCard").classList.contains("hidden")));
  note("cleanChipActive", await page.evaluate(() => document.querySelector('[data-tool-switch="clean"]').classList.contains("active")));
  // (3) Upload file berlabel -> alat jalan sendiri -> tombol utama "Simpan foto".
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await page.waitForFunction(() => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, { timeout: 60000 });
  await page.waitForTimeout(400);
  note("cleanPill", await cardPill(0));
  note("toolStatusCleanDone", await toolStatusText());
  note("primaryAfterClean", await primaryText());
  // Pengaturan TETAP tampil walau file sudah masuk (dulu hilang).
  note("settingsStillVisible", await page.evaluate(() => !document.getElementById("settingsCard").classList.contains("hidden")));
  // (4) Ganti alat ke Hapus Objek via chip -> editor langsung terbuka
  // (coretan = input, prinsip B); tutup -> file & hasil Bersihkan tetap.
  await page.click('[data-tool-switch="erase"]');
  await page.waitForFunction(() => !document.getElementById("eraseModal").classList.contains("hidden"), { timeout: 15000 });
  note("eraseModalAutoOpenOnSwitch", await page.evaluate(() => !document.getElementById("eraseModal").classList.contains("hidden")));
  await page.click("#eraseClose");
  await page.waitForTimeout(600);
  note("toolStatusErase", await toolStatusText());
  note("settingsHiddenErase", await page.evaluate(() => document.getElementById("settingsCard").classList.contains("hidden")));
  note("pillAfterSwitch", await cardPill(0));
  note("primaryAfterSwitchErase", await primaryText());
  // (5) Balik ke pemilih -> pilih Bersihkan lagi -> kartu masih ada.
  // Tombol Back di top bar editor (#editorBackBtn); chip "‹ Semua alat"
  // [data-tool-switch=""] sudah dihapus saat redesain layout — selector
  // usang itu dulu timeout 30 dtk dan ditelan try/catch, sehingga
  // langkah 5–6 tidak pernah dieksekusi.
  await page.click("#editorBackBtn");
  await page.waitForTimeout(600);
  note("pickerAgain", await page.evaluate(() => !document.getElementById("heroSection").classList.contains("hidden")));
  await page.click('[data-tool="clean"]');
  await page.waitForTimeout(600);
  note("cardKept", await page.evaluate(() => document.querySelectorAll("#list article").length));
  note("pillKept", await cardPill(0));
  // (6) Mulai ulang -> balik ke pemilih. Pilih Hapus Objek -> upload
  // langsung buka editor (prinsip B): pill tetap "Ada label AI" sampai
  // dicoret, tombol utama jadi "Coret foto" (bukan "Simpan").
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  await page.click("#sheetConfirm"); // konfirmasi sheet (Phase 2)
  await page.waitForTimeout(600);
  note("pickerAfterRestart", await page.evaluate(() => !document.getElementById("heroSection").classList.contains("hidden")));
  await page.click('[data-tool="erase"]');
  await page.waitForTimeout(600);
  note("toolStatusEraseEmpty", await toolStatusText());
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await page.waitForFunction(() => !document.getElementById("eraseModal").classList.contains("hidden"), { timeout: 15000 });
  note("eraseModalAutoOpenOnUpload", await page.evaluate(() => !document.getElementById("eraseModal").classList.contains("hidden")));
  await page.click("#eraseClose");
  await page.waitForTimeout(600);
  note("eraseQueuePill", await cardPill(0));
  note("primaryEraseNoResult", await primaryText());
  note("dockHidden", await page.evaluate(() => document.getElementById("procDock").classList.contains("hidden")));
  note("toolStatusEraseQueued", await toolStatusText());
  note("eraseToast", await page.locator("#toast").textContent());
  // Tombol utama "Coret foto" -> editor terbuka lagi -> tutup.
  await page.click("#primaryBtn");
  await page.waitForFunction(() => !document.getElementById("eraseModal").classList.contains("hidden"), { timeout: 15000 });
  note("eraseModalOpen", await page.evaluate(() => !document.getElementById("eraseModal").classList.contains("hidden")));
  await page.click("#eraseClose");
  await page.waitForTimeout(400);
  note("eraseModalClosed", await page.evaluate(() => document.getElementById("eraseModal").classList.contains("hidden")));
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
await ctx.close();
server.kill();

// 390px: pemilih + baris chip tanpa overflow horizontal.
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
const page2 = await ctx2.newPage();
const consoleErrors2 = [];
page2.on("console", (m) => { if (m.type() === "error") consoleErrors2.push(m.text()); });
const server2 = spawn("node", [new URL("./serve-sirna.mjs", import.meta.url).pathname, "/home/hatch/workspace/sirna-vite/dist", "4173"], { stdio: "pipe" });
for (let i = 0; i < 20; i++) {
  try { const r = await fetch(BASE); if (r.ok) break; } catch (_e) {}
  await new Promise((r) => setTimeout(r, 500));
}
try {
  await page2.goto(BASE, { waitUntil: "networkidle" });
  await page2.waitForTimeout(1000);
  note("m390_overflow", await page2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  await page2.click('[data-tool="clean"]');
  await page2.waitForTimeout(600);
  // Rail kini SATU baris scroll horizontal (P0-1), bukan wrap: scrollWidth >
  // clientWidth itu BENAR — yang dicek: chip terakhir bisa dicapai dengan
  // scroll, ada fade di tepi kanan, dan halaman tetap tanpa overflow.
  note("m390_railScrollable", await page2.evaluate(() => {
    const b = document.getElementById("toolBar");
    return b.scrollWidth - b.clientWidth;
  }));
  note("m390_railFade", await page2.evaluate(() => {
    const cs = getComputedStyle(document.getElementById("toolBar"));
    return (cs.maskImage || cs.webkitMaskImage || "").includes("linear-gradient");
  }));
  note("m390_railLastChipReachable", await page2.evaluate(async () => {
    const b = document.getElementById("toolBar");
    b.scrollLeft = b.scrollWidth;
    await new Promise((r) => setTimeout(r, 200));
    const last = b.querySelector(".tool-chip:last-child");
    const br = b.getBoundingClientRect(), cr = last.getBoundingClientRect();
    return cr.right <= br.right + 1 && cr.left >= br.left - 1;
  }));
  note("m390_overflowAfter", await page2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
} catch (e) {
  note("ERROR390", String(e && e.stack || e));
}
note("consoleErrors390", consoleErrors2.slice(0, 10));
await ctx2.close();
server2.kill();
await browser.close();
// Jangan telan kegagalan diam-diam: kalau ada ERROR/ERROR390 di log,
// langkah workflow ada yang tidak tereksekusi — skrip harus exit 1,
// bukan DONE dengan exit 0.
if (log.some(([k]) => k === "ERROR" || k === "ERROR390")) process.exitCode = 1;
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
