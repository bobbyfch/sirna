// Layout kanonis Phase 2 (19 Nov 2026, arah Bobby 08:49 WIB):
// home = pemilih alat (tanpa default) -> "Coba foto contoh" cuma mengantre
// (tidak ada alat yang jalan otomatis) -> pilih alat -> editor kanonis
// (filmstrip + canvas + status + versi + rail scroll + tombol utama sticky)
// -> chaining lewat rail -> sheet konfirmasi. + 390px tanpa overflow.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const F = (p) => new URL("./fixtures/" + p, import.meta.url).pathname;
const OUT = "/tmp/layout-e2e-result.json";
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
const consoleErrors = [];
const pageErrors = [];
async function waitFor(pg, fn, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    if (await pg.evaluate(fn)) return;
    if (Date.now() - t0 > timeout) throw new Error("waitFor timeout: " + fn.toString().slice(0, 120));
    await pg.waitForTimeout(100);
  }
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // (1) Home: pemilih alat, 7 kartu, TANPA alat aktif / default.
  note("h1", await page.locator("h1").textContent());
  note("pickerCards", await page.evaluate(() => Array.from(document.querySelectorAll("#toolPicker .tool-card")).map((c) => c.dataset.tool).join(",")));
  note("panelHidden", await page.evaluate(() => document.getElementById("panel-cleaner").classList.contains("hidden")));
  note("noActiveChip", await page.evaluate(() => document.querySelectorAll("[data-tool-switch].active").length));
  note("primaryHidden", await page.evaluate(() => document.getElementById("primaryBar").classList.contains("hidden")));
  note("editorHeadHidden", await page.evaluate(() => document.getElementById("editorHead").classList.contains("hidden")));
  note("sampleBtnVisible", await page.evaluate(() => document.getElementById("sampleBtn").getBoundingClientRect().width > 0));

  // (2) Coba foto contoh: file diantre, banner muncul, TIDAK ada alat jalan.
  await page.click("#sampleBtn");
  await waitFor(page, () => !document.getElementById("sampleBanner").classList.contains("hidden"), 10000);
  await page.waitForTimeout(400);
  note("sampleBanner", await page.locator("#sampleBanner").textContent());
  note("sampleToast", await page.locator("#toast").textContent());
  note("panelStillHidden", await page.evaluate(() => document.getElementById("panel-cleaner").classList.contains("hidden")));
  note("noActiveChipAfterSample", await page.evaluate(() => document.querySelectorAll("[data-tool-switch].active").length));
  note("primaryStillHidden", await page.evaluate(() => document.getElementById("primaryBar").classList.contains("hidden")));

  // (3) Pilih Bersihkan: workspace + kepala editor muncul; file staged
  // (belum dibersihkan — proses jalan lewat tombol utama, bukan otomatis).
  await page.click('[data-tool="clean"]');
  await page.waitForTimeout(700);
  note("editorHeadVisible", await page.evaluate(() => !document.getElementById("editorHead").classList.contains("hidden")));
  note("shellPillStaged", await page.locator("#shellPill").textContent());
  note("shellStatusStaged", await page.locator("#shellStatus").textContent());
  note("shellImgSize", await page.evaluate(() => { const i = document.getElementById("shellImg"); return [i.naturalWidth, i.naturalHeight]; }));
  note("filmThumbs", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb").length));
  note("filmActive", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb.active").length));
  note("shellVersionsHidden", await page.evaluate(() => document.getElementById("shellVersions").classList.contains("hidden")));
  note("shellUndoHidden", await page.evaluate(() => document.getElementById("shellUndo").classList.contains("hidden")));
  note("primaryLabelClean", await page.locator("#primaryBtn").textContent());
  note("topBackVisible", await page.evaluate(() => !document.getElementById("topBackBtn").classList.contains("hidden")));
  note("topExportHidden", await page.evaluate(() => document.getElementById("topExportBtn").classList.contains("hidden")));

  // (4) Tombol utama "Bersihkan label" -> bersih -> "Simpan foto".
  await page.click("#primaryBtn");
  await waitFor(page, () => document.querySelectorAll('button[data-act="save"]:not(.hidden)').length >= 1, 30000);
  await page.waitForTimeout(400);
  note("cardPillAfterClean", await page.evaluate(() => document.querySelector("#list article .status-pill")?.textContent?.trim()));
  note("shellPillAfterClean", await page.locator("#shellPill").textContent());
  note("shellStatusAfterClean", await page.locator("#shellStatus").textContent());
  note("primaryLabelAfterClean", await page.locator("#primaryBtn").textContent());
  note("topExportVisible", await page.evaluate(() => !document.getElementById("topExportBtn").classList.contains("hidden")));
  note("shellVersionsVisible", await page.evaluate(() => !document.getElementById("shellVersions").classList.contains("hidden")));
  note("shellUndoVisible", await page.evaluate(() => !document.getElementById("shellUndo").classList.contains("hidden")));

  // (5) Tahan-lihat-asli di shell: src berubah ke asli saat ditahan.
  const srcBefore = await page.evaluate(() => document.getElementById("shellImg").getAttribute("data-cur"));
  const cmpBox = await page.locator("#shellCompare").boundingBox();
  await page.mouse.move(cmpBox.x + cmpBox.width / 2, cmpBox.y + cmpBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  const srcHolding = await page.evaluate(() => document.getElementById("shellImg").getAttribute("data-cur"));
  await page.mouse.up();
  await page.waitForTimeout(300);
  const srcAfter = await page.evaluate(() => document.getElementById("shellImg").getAttribute("data-cur"));
  note("compareChangesSrc", srcBefore !== srcHolding);
  note("compareRestoresSrc", srcBefore === srcAfter);

  // (6) Urungkan di shell: kembali ke Asli, pill "Ada label AI".
  await page.click("#shellUndo");
  await page.waitForTimeout(500);
  note("pillAfterShellUndo", await page.evaluate(() => document.querySelector("#list article .status-pill")?.textContent?.trim()));
  note("shellPillAfterUndo", await page.locator("#shellPill").textContent());
  note("primaryLabelAfterUndo", await page.locator("#primaryBtn").textContent());

  // (7) Chaining lewat rail: ganti ke Hapus Objek — foto & hasil ikut,
  // tombol utama jadi kata kerja alat itu.
  await page.click('[data-tool-switch="erase"]');
  await page.waitForTimeout(600);
  note("primaryLabelErase", await page.locator("#primaryBtn").textContent());
  note("shellImgStillSame", await page.evaluate(() => { const i = document.getElementById("shellImg"); return [i.naturalWidth, i.naturalHeight]; }));
  note("cardKeptAfterSwitch", await page.evaluate(() => document.querySelectorAll("#list article").length));
  // Tombol utama Hapus Objek membuka editor.
  await page.click("#primaryBtn");
  await waitFor(page, () => !document.getElementById("eraseModal").classList.contains("hidden"), 10000);
  note("eraseModalFromPrimary", true);
  await page.click("#eraseClose");
  await page.waitForTimeout(400);

  // (8) Sheet konfirmasi: Batal = tidak jadi; Konfirmasi = mulai ulang.
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  note("sheetVisible", await page.evaluate(() => !document.getElementById("sheet").classList.contains("hidden")));
  note("sheetTitle", await page.locator("#sheetTitle").textContent());
  await page.click("#sheetCancel");
  await page.waitForTimeout(400);
  note("sheetHiddenAfterCancel", await page.evaluate(() => document.getElementById("sheet").classList.contains("hidden")));
  note("cardsKeptAfterCancel", await page.evaluate(() => document.querySelectorAll("#list article").length));
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  await page.click("#sheetConfirm");
  await page.waitForTimeout(600);
  note("pickerAfterRestart", await page.evaluate(() => !document.getElementById("heroSection").classList.contains("hidden")));
  note("cardsAfterRestart", await page.evaluate(() => document.querySelectorAll("#list article").length));

  // (9) Tombol kembali di topbar: pilih alat tanpa file -> kembali ke pemilih.
  await page.click('[data-tool="erase"]');
  await page.waitForTimeout(500);
  note("topBackVisibleNoFile", await page.evaluate(() => !document.getElementById("topBackBtn").classList.contains("hidden")));
  await page.click("#topBackBtn");
  await page.waitForTimeout(500);
  note("pickerAfterTopBack", await page.evaluate(() => !document.getElementById("heroSection").classList.contains("hidden")));
  await ctx.close();

  // ── Konteks 2: 390px — editor kanonis tanpa overflow. ──
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
  const page2 = await ctx2.newPage();
  page2.on("console", (m) => { if (m.type() === "error") consoleErrors.push("ctx2: " + m.text()); });
  page2.on("pageerror", (e) => pageErrors.push("ctx2: " + String(e)));
  await page2.goto(BASE, { waitUntil: "networkidle" });
  await page2.waitForTimeout(1000);
  note("m390_overflowHome", await page2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  await page2.click('[data-tool="clean"]');
  await page2.waitForTimeout(500);
  await page2.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await waitFor(page2, () => document.querySelectorAll('button[data-act="save"]:not(.hidden)').length >= 1, 30000);
  await page2.waitForTimeout(500);
  note("m390_editorHeadVisible", await page2.evaluate(() => !document.getElementById("editorHead").classList.contains("hidden")));
  note("m390_canvasHeight", await page2.evaluate(() => {
    const r = document.getElementById("shellImg").getBoundingClientRect();
    return { h: Math.round(r.height), vh55: Math.round(window.innerHeight * 0.55) };
  }));
  note("m390_primaryVisible", await page2.evaluate(() => {
    const b = document.getElementById("primaryBar");
    if (b.classList.contains("hidden")) return false;
    const r = b.getBoundingClientRect();
    return r.bottom <= window.innerHeight + 1 && r.bottom >= window.innerHeight - 100;
  }));
  note("m390_primaryLabel", await page2.locator("#primaryBtn").textContent());
  note("m390_railScrollable", await page2.evaluate(() => {
    const b = document.getElementById("toolBar");
    return b.scrollWidth - b.clientWidth;
  }));
  note("m390_overflowAfter", await page2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  note("m390_filmScrollable", await page2.evaluate(() => {
    const f = document.getElementById("shellFilm");
    return f.scrollWidth - f.clientWidth;
  }));
  await ctx2.close();
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
await browser.close();
server.kill();
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
