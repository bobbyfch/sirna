// Alur file-first (3 alat, tanpa model): home (dropzone + contoh, tanpa
// pemilih alat) -> upload -> editor terbuka, Bersihkan jalan sendiri ->
// Sudah bersih -> ganti alat via chip (file & hasil tetap, alat baru
// langsung jalan otomatis) -> Back -> "Buka editor" -> editor kembali ->
// Mulai ulang -> upload langsung jalan otomatis -> chip watermark v1
// (sparkle Gemini saja, tanpa editor kuas).
// + 390px tanpa overflow, 0 error konsol.
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
async function shellPill() {
  return await page.evaluate(() => document.getElementById("shellPill")?.textContent?.trim() || "");
}
async function filmCount() {
  return await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb").length);
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  // (1) Layar A file-first: dropzone + contoh kelihatan, TIDAK ADA
  // #toolPicker di DOM, workspace sembunyi.
  note("pickerVisible", await page.evaluate(() => !document.getElementById("heroSection").classList.contains("hidden")));
  note("dropzoneVisible", await page.evaluate(() => { const d = document.getElementById("dropZone"); const r = d.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.top < window.innerHeight; }));
  note("toolPickerAbsent", await page.evaluate(() => !document.getElementById("toolPicker")));
  note("sampleRowBelowDropzone", await page.evaluate(() => { const d = document.getElementById("dropZone").getBoundingClientRect(), s = document.getElementById("sampleRow").getBoundingClientRect(); return s.top >= d.bottom; }));
  note("panelHidden", await page.evaluate(() => document.getElementById("panel-cleaner").classList.contains("hidden")));
  // (2) Upload langsung dari home -> editor terbuka, Bersihkan jalan
  // sendiri (default), baris status + pengaturan tampil.
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await page.waitForFunction(() => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, { timeout: 60000 });
  await page.waitForTimeout(400);
  note("panelVisible", await page.evaluate(() => !document.getElementById("panel-cleaner").classList.contains("hidden")));
  note("heroHidden", await page.evaluate(() => document.getElementById("heroSection").classList.contains("hidden")));
  note("toolStatusClean", await toolStatusText());
  note("settingsVisible", await page.evaluate(() => !document.getElementById("settingsCard").classList.contains("hidden")));
  note("cleanChipActive", await page.evaluate(() => document.querySelector('[data-tool-switch="clean"]').classList.contains("active")));
  // (3) File berlabel sudah dibersihkan otomatis -> tombol utama "Simpan foto".
  note("cleanPill", await shellPill());
  note("toolStatusCleanDone", await toolStatusText());
  note("primaryAfterClean", await primaryText());
  // Pengaturan TETAP tampil walau file sudah masuk (dulu hilang).
  note("settingsStillVisible", await page.evaluate(() => !document.getElementById("settingsCard").classList.contains("hidden")));
  // (4) Ganti alat ke Hapus Watermark via chip -> auto-run v1 (tanpa
  // modal kuas): status jujur di #shellResult; file & hasil Bersihkan tetap.
  await page.click('[data-tool-switch="watermark"]');
  // Tunggu status jujur watermark v1 (kotak lama "Beres" dari Bersihkan
  // diganti — tunggu teks baru, bukan sekadar kotak terlihat).
  await page.waitForFunction(() => {
    const t = document.getElementById("shellResult")?.textContent || "";
    return t.includes("Tidak ketemu tanda watermark") || t.includes("bukan pola Gemini") || t.includes("Sparkle Gemini dihapus");
  }, { timeout: 15000 });
  note("wmModalAbsent", await page.evaluate(() => !document.getElementById("eraseModal")));
  note("wmResult", await page.locator("#shellResult").textContent());
  await page.waitForTimeout(600);
  note("toolStatusWatermark", await toolStatusText());
  note("settingsHiddenWatermark", await page.evaluate(() => document.getElementById("settingsCard").classList.contains("hidden")));
  note("pillAfterSwitch", await shellPill());
  note("primaryAfterSwitchWatermark", await primaryText());
  // (5) Balik ke home -> #queueHint terlihat ("1 file di antrean") ->
  // klik "Buka editor" -> editor kembali, file masih ada.
  await page.click("#editorBackBtn");
  await page.waitForTimeout(600);
  note("pickerAgain", await page.evaluate(() => !document.getElementById("heroSection").classList.contains("hidden")));
  note("queueHintVisible", await page.evaluate(() => !document.getElementById("queueHint").classList.contains("hidden")));
  note("queueHintText", await page.evaluate(() => document.getElementById("queueHintText")?.textContent?.trim()));
  await page.click("#resumeBtn");
  await page.waitForTimeout(600);
  note("filmKept", await filmCount());
  note("pillKept", await shellPill());
  // (6) Mulai ulang -> home. Upload langsung (default Bersihkan jalan)
  // -> klik chip watermark -> auto-run v1: hasil Bersihkan sudah ada,
  // jadi tombol utama tetap "Simpan foto"; status jujur di kotak hasil
  // — TANPA modal kuas, TANPA tombol "Coret watermark".
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  await page.click("#sheetConfirm"); // konfirmasi sheet (Phase 2)
  await page.waitForTimeout(600);
  note("pickerAfterRestart", await page.evaluate(() => !document.getElementById("heroSection").classList.contains("hidden")));
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await page.waitForFunction(() => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, { timeout: 60000 });
  note("toolStatusAfterCleanUpload", await toolStatusText());
  await page.click('[data-tool-switch="watermark"]');
  await page.waitForFunction(() => {
    const t = document.getElementById("shellResult")?.textContent || "";
    return t.includes("Tidak ketemu tanda watermark") || t.includes("bukan pola Gemini") || t.includes("Sparkle Gemini dihapus");
  }, { timeout: 15000 });
  note("wmModalAbsentUpload", await page.evaluate(() => !document.getElementById("eraseModal")));
  note("wmResultUpload", await page.locator("#shellResult").textContent());
  await page.waitForTimeout(600);
  note("wmQueuePill", await shellPill());
  note("primaryWatermarkNoResult", await page.evaluate(() => document.getElementById("primaryBtn").classList.contains("hidden") ? "(hidden)" : document.getElementById("primaryBtn").textContent.trim()));
  note("dockHidden", await page.evaluate(() => document.getElementById("procDock").classList.contains("hidden")));
  note("toolStatusWatermarkQueued", await toolStatusText());
  note("wmToast", await page.locator("#toast").textContent());
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
  // File-first 390px: upload langsung dari home membuka editor.
  await page2.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await page2.waitForFunction(() => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, { timeout: 60000 });
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
if (log.some(([k]) => k === "ERROR" || k === "ERROR390")) process.exitCode = 1;
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
