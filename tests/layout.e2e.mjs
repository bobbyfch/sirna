// Layout kanonis redesain (19 Nov 2026):
// home = pemilih alat (tanpa default) -> "Coba foto contoh" cuma mengantre
// (tidak ada alat yang jalan otomatis) -> pilih alat -> alat JALAN SENDIRI
// -> editor kanonis (filmstrip + canvas + status + versi + rail scroll +
// tombol utama sticky "Simpan foto") -> chaining lewat rail -> sheet
// konfirmasi. + 390px tanpa overflow.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("/home/hatch/workspace/sirna-p0-fix", { recursive: true });

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
/* Klik "Coba foto contoh": thumbnail DI BAWAH dropzone workspace (Fase 2)
   — tombolnya cuma ada setelah alat dipilih (panel tampil, belum ada
   file); klik = file contoh masuk + alat yang dipilih langsung jalan. */
async function clickSample(pg){
  await pg.click("#sampleBtn");
}
/* Simpan di top bar editor terlihat + bisa diketuk: tombolnya di dalam
   viewport, tidak tertutup toast / maskot / dock. */
async function assertSaveTappable(pg, tag){
  const r = await pg.evaluate(() => {
    const b = document.getElementById("primaryBtn");
    if (!b || b.classList.contains("hidden")) return { visible: false };
    const rect = b.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const el = document.elementFromPoint(cx, cy);
    return { visible: true, inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth,
      centerHit: el === b || b.contains(el), hitTag: el ? (el.id || el.className || el.tagName) : null,
      top: Math.round(rect.top), h: Math.round(rect.height) };
  });
  note(tag + "_saveTappable", r);
  if (!r.visible) throw new Error("tombol Simpan tidak tampil @" + tag);
  if (!r.inViewport) throw new Error("tombol Simpan di luar viewport @" + tag + ": " + JSON.stringify(r));
  if (!r.centerHit) throw new Error("tombol Simpan tertutup " + r.hitTag + " @" + tag);
  if (r.h < 44) throw new Error("tombol Simpan < 44px @" + tag + ": " + r.h);
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // (1) Home: pemilih alat, 7 kartu (tile contoh KELUAR dari grid, Fase 2),
  // TANPA alat aktif / default. Simpan di top bar sembunyi (belum ada
  // hasil); contoh cuma ada di bawah dropzone workspace (panel sembunyi).
  note("h1", await page.locator("h1").textContent());
  note("pickerCards", await page.evaluate(() => Array.from(document.querySelectorAll("#toolPicker .tool-card")).map((c) => c.dataset.tool).filter(Boolean).join(",")));
  note("pickerTileCount", await page.evaluate(() => document.querySelectorAll("#toolPicker .tool-card").length));
  note("panelHidden", await page.evaluate(() => document.getElementById("panel-cleaner").classList.contains("hidden")));
  note("noActiveChip", await page.evaluate(() => document.querySelectorAll("[data-tool-switch].active").length));
  note("primaryHidden", await page.evaluate(() => document.getElementById("primaryBtn").classList.contains("hidden")));
  note("editorHeadHidden", await page.evaluate(() => document.getElementById("editorHead").classList.contains("hidden")));
  note("sampleInPanel", await page.evaluate(() => document.getElementById("sampleBtn").closest("#panel-cleaner") !== null));
  note("noStickyBottomBar", await page.evaluate(() => !document.getElementById("primaryBar")));
  note("siteHeaderVisible", await page.evaluate(() => getComputedStyle(document.querySelector("header")).display !== "none"));

  // (2) File TANPA alat (drop via input, tanpa pilih alat): file diantre,
  // banner muncul, TIDAK ada alat jalan, panel tetap tersembunyi (kelas).
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await waitFor(page, () => !document.getElementById("sampleBanner").classList.contains("hidden"), 10000);
  await page.waitForTimeout(400);
  note("sampleBanner", await page.locator("#sampleBanner").textContent());
  note("sampleToast", await page.locator("#toast").textContent());
  note("panelStillHidden", await page.evaluate(() => document.getElementById("panel-cleaner").classList.contains("hidden")));
  note("noActiveChipAfterSample", await page.evaluate(() => document.querySelectorAll("[data-tool-switch].active").length));
  note("primaryStillHidden", await page.evaluate(() => document.getElementById("primaryBtn").classList.contains("hidden")));

  // (3) Pilih Bersihkan: editor MENGGANTIKAN home (hero + grid hilang,
  // header situs hilang, top bar editor tampil); alat JALAN SENDIRI
  // (prinsip A) — tunggu tombol Simpan di top bar jadi "Simpan foto".
  await page.click('[data-tool="clean"]');
  await waitFor(page, () => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, 30000);
  await page.waitForTimeout(400);
  note("heroHiddenInEditor", await page.evaluate(() => document.getElementById("heroSection").classList.contains("hidden")));
  note("siteHeaderHiddenInEditor", await page.evaluate(() => getComputedStyle(document.querySelector("header")).display === "none"));
  note("editorTopBarVisible", await page.evaluate(() => { const t = document.getElementById("editorTopBar"); const r = t.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.top < 80; }));
  note("editorTopBarSticky", await page.evaluate(() => getComputedStyle(document.getElementById("editorTopBar")).position === "sticky"));
  note("editorHeadVisible", await page.evaluate(() => !document.getElementById("editorHead").classList.contains("hidden")));
  note("dropZoneHiddenWithFile", await page.evaluate(() => document.getElementById("dropZone").classList.contains("hidden")));
  note("shellPillAfterAutoClean", await page.locator("#shellPill").textContent());
  note("shellStatusAfterAutoClean", await page.locator("#shellStatus").textContent());
  note("shellImgSize", await page.evaluate(() => { const i = document.getElementById("shellImg"); return [i.naturalWidth, i.naturalHeight]; }));
  note("filmThumbs", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb").length));
  note("filmActive", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb.active").length));
  note("shellVersionsVisible", await page.evaluate(() => !document.getElementById("shellVersions").classList.contains("hidden")));
  note("shellUndoAbsent", await page.evaluate(() => !document.getElementById("shellUndo"))); // satu undo: chip Versi (prinsip I)
  note("primaryLabelClean", await page.locator("#primaryBtn").textContent());
  note("editorBackVisible", await page.evaluate(() => { const b = document.getElementById("editorBackBtn"); const r = b.getBoundingClientRect(); return r.width > 0 && r.height >= 44; }));
  note("topExportAbsent", await page.evaluate(() => !document.getElementById("topExportBtn"))); // satu jalur simpan (prinsip C)
  await assertSaveTappable(page, "desk1280_clean");

  // (4) Tombol utama "Simpan foto" -> download hasil (satu jalur simpan).
  const dlPromise = page.waitForEvent("download", { timeout: 30000 });
  await page.click("#primaryBtn");
  const dl = await dlPromise;
  note("downloadName", dl.suggestedFilename());
  await page.waitForTimeout(400);
  note("cardPillAfterClean", await page.evaluate(() => document.querySelector("#list article .status-pill")?.textContent?.trim()));
  note("shellPillAfterClean", await page.locator("#shellPill").textContent());
  note("shellStatusAfterClean", await page.locator("#shellStatus").textContent());
  note("primaryLabelAfterClean", await page.locator("#primaryBtn").textContent());
  note("shellVersionsVisible", await page.evaluate(() => !document.getElementById("shellVersions").classList.contains("hidden")));

  // (5) "Lihat asli" di shell = toggle ketuk-sekali (prinsip I):
  // ketuk -> src asli; ketuk lagi -> kembali ke hasil.
  const srcBefore = await page.evaluate(() => document.getElementById("shellImg").getAttribute("data-cur"));
  await page.click("#shellCompare");
  await page.waitForTimeout(300);
  const srcToggled = await page.evaluate(() => document.getElementById("shellImg").getAttribute("data-cur"));
  await page.click("#shellCompare");
  await page.waitForTimeout(300);
  const srcAfter = await page.evaluate(() => document.getElementById("shellImg").getAttribute("data-cur"));
  note("compareChangesSrc", srcBefore !== srcToggled);
  note("compareRestoresSrc", srcBefore === srcAfter);
  note("comparePressed", await page.evaluate(() => document.getElementById("shellCompare").getAttribute("aria-pressed")));

  // (6) Kembali ke versi "Asli" lewat chip Versi (satu undo, prinsip I):
  // pill kembali "Ada label AI", hasil Bersihkan tetap tersimpan.
  await page.click('#shellVersions button[data-v="Asli"]');
  await page.waitForTimeout(500);
  note("pillAfterVersionAsli", await page.evaluate(() => document.querySelector("#list article .status-pill")?.textContent?.trim()));
  note("shellPillAfterAsli", await page.locator("#shellPill").textContent());
  note("primaryLabelAfterAsli", await page.locator("#primaryBtn").textContent());

  // (7) Chaining lewat rail: ganti ke Hapus Objek — editor langsung
  // terbuka (prinsip B), foto & hasil Bersihkan ikut.
  await page.click('[data-tool-switch="erase"]');
  await waitFor(page, () => !document.getElementById("eraseModal").classList.contains("hidden"), 10000);
  note("eraseModalAutoOpenOnSwitch", true);
  await page.click("#eraseClose");
  await page.waitForTimeout(600);
  note("primaryLabelErase", await page.locator("#primaryBtn").textContent());
  note("shellImgStillSame", await page.evaluate(() => { const i = document.getElementById("shellImg"); return [i.naturalWidth, i.naturalHeight]; }));
  note("cardKeptAfterSwitch", await page.evaluate(() => document.querySelectorAll("#list article").length));
  // Tombol utama "Coret foto" membuka editor lagi.
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

  // (9) Tombol "‹ Back" di top bar editor: pilih alat tanpa file ->
  // kembali ke pemilih; header situs muncul lagi.
  await page.click('[data-tool="erase"]');
  await page.waitForTimeout(500);
  note("editorBackVisibleNoFile", await page.evaluate(() => { const b = document.getElementById("editorBackBtn"); const r = b.getBoundingClientRect(); return r.width > 0 && r.height >= 44; }));
  note("siteHeaderHiddenNoFile", await page.evaluate(() => getComputedStyle(document.querySelector("header")).display === "none"));
  await page.click("#editorBackBtn");
  await page.waitForTimeout(500);
  note("pickerAfterTopBack", await page.evaluate(() => !document.getElementById("heroSection").classList.contains("hidden")));
  note("siteHeaderBackAfterBack", await page.evaluate(() => getComputedStyle(document.querySelector("header")).display !== "none"));

  // (10) Foto contoh dari bawah dropzone: pilih alat dulu, lalu klik
  // thumbnail contoh -> alat langsung jalan (prinsip A), editor tampil.
  await page.click('[data-tool="clean"]');
  await page.waitForTimeout(600);
  note("sampleRowVisible", await page.evaluate(() => { const r = document.getElementById("sampleRow"); return !r.classList.contains("hidden") && r.offsetParent !== null; }));
  note("sampleThumbLoaded", await page.evaluate(async () => { const img = document.getElementById("sampleThumbImg"); for (let i = 0; i < 30 && !img.src; i++) await new Promise((r) => setTimeout(r, 100)); return !!img.src && img.naturalWidth > 0; }));
  await clickSample(page);
  await waitFor(page, () => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, 30000);
  await page.waitForTimeout(400);
  note("sampleAutoCleanPill", await page.locator("#shellPill").textContent());
  note("sampleRowHiddenWithFile", await page.evaluate(() => document.getElementById("sampleRow").classList.contains("hidden")));
  await assertSaveTappable(page, "desk1280_sample");
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
  await waitFor(page2, () => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, 30000);
  await page2.waitForTimeout(500);
  note("m390_editorHeadVisible", await page2.evaluate(() => !document.getElementById("editorHead").classList.contains("hidden")));
  note("m390_canvasHeight", await page2.evaluate(() => {
    const r = document.getElementById("shellImg").getBoundingClientRect();
    return { h: Math.round(r.height), vh55: Math.round(window.innerHeight * 0.55) };
  }));
  // Simpan di TOP BAR (bukan sticky bawah): kelihatan tanpa scroll,
  // di baris atas viewport, dan kanvas full-bleed selebar layar.
  note("m390_saveInTopBar", await page2.evaluate(() => {
    const b = document.getElementById("primaryBtn");
    if (b.classList.contains("hidden")) return false;
    const r = b.getBoundingClientRect();
    const wrap = document.querySelector(".shell-canvas-wrap").getBoundingClientRect();
    return { top: Math.round(r.top), h: Math.round(r.height), canvasLeft: Math.round(wrap.left), canvasRight: Math.round(wrap.right), vw: window.innerWidth };
  }));
  note("m390_primaryLabel", await page2.locator("#primaryBtn").textContent());
  await assertSaveTappable(page2, "m390_clean");
  note("m390_railScrollable", await page2.evaluate(() => {
    const b = document.getElementById("toolBar");
    return b.scrollWidth - b.clientWidth;
  }));
  note("m390_overflowAfter", await page2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  note("m390_filmScrollable", await page2.evaluate(() => {
    const f = document.getElementById("shellFilm");
    return f.scrollWidth - f.clientWidth;
  }));

  // (10) Redesain (prinsip E): rel kartu DIHAPUS — yang tersisa cuma
  // rail kepala editor (#toolBar). + tombol utama tidak terpotong
  // gesture bar + editor terlihat setelah pilih alat. Screenshot (a)
  // kartu file, (b) kepala editor — dilihat manual.
  await page2.evaluate(() => document.querySelector("#list article").scrollIntoView({ block: "start" }));
  await page2.waitForTimeout(600);
  await page2.screenshot({ path: "/home/hatch/workspace/sirna-p0-fix/card-390.png" });
  note("shotCard", "sirna-p0-fix/card-390.png");
  await page2.evaluate(() => document.getElementById("editorHead").scrollIntoView({ block: "start" }));
  await page2.waitForTimeout(600);
  await page2.screenshot({ path: "/home/hatch/workspace/sirna-p0-fix/editor-390.png" });
  note("shotEditor", "sirna-p0-fix/editor-390.png");
  // Hard assertions — gagal = throw, bukan cuma log.
  // Simpan di top bar: tombol di baris atas (top < 80px), ≥44px, dan
  // TIDAK ADA lagi sticky bottom bar (#primaryBar sudah tidak ada).
  const pBtn = await page2.locator("#primaryBtn").boundingBox();
  const vh = page2.viewportSize().height;
  note("p0_saveBtnTop", Math.round(pBtn.y));
  note("p0_saveBtnHeight", Math.round(pBtn.height));
  note("p0_viewportHeight", vh);
  if (pBtn.y > 80) throw new Error("tombol Simpan bukan di top bar: top " + Math.round(pBtn.y));
  if (pBtn.height < 44) throw new Error("tombol Simpan < 44px: " + Math.round(pBtn.height));
  if (await page2.evaluate(() => !!document.getElementById("primaryBar"))) throw new Error("sticky bottom bar #primaryBar masih ada — harus dihapus");
  // Kanvas full-bleed di 390px: tepi kiri ≈ 0, tepi kanan ≈ lebar layar.
  const canvasBleed = await page2.evaluate(() => {
    const r = document.querySelector(".shell-canvas-wrap").getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth };
  });
  note("p0_canvasBleed", canvasBleed);
  if (canvasBleed.left > 2 || Math.abs(canvasBleed.right - canvasBleed.vw) > 2) throw new Error("kanvas tidak full-bleed di 390px: " + JSON.stringify(canvasBleed));
  const railCheck = await page2.evaluate(() => {
    const cardRail = document.querySelector("#list article .tool-bar");
    const bar = document.getElementById("toolBar");
    const chips = Array.from(bar.querySelectorAll(".tool-chip"));
    return {
      cardRailPresent: !!cardRail,
      oldRail: document.querySelectorAll("#list .tool-rail").length,
      toolBarChipCount: chips.length,
      chipMinHeight: Math.min(...chips.map((c) => Math.round(c.getBoundingClientRect().height))),
      allOpaque: chips.every((c) => { const bg = getComputedStyle(c).backgroundColor; return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent"; }),
      activeFilled: (() => { const a = bar.querySelector(".tool-chip.active"); if (!a) return false; const bg = getComputedStyle(a).backgroundColor; return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent"; })(),
      labels: chips.map((c) => c.textContent.trim()).join("|"),
    };
  });
  note("p0_cardRail", railCheck);
  if (railCheck.cardRailPresent) throw new Error("card rail .tool-bar still present — harus dihapus (prinsip E)");
  if (railCheck.oldRail) throw new Error("old .tool-rail still present in card");
  if (railCheck.toolBarChipCount !== 7) throw new Error("toolBar harus 7 chip (7 alat; '‹ Semua alat' pindah jadi tombol Back di top bar), got " + railCheck.toolBarChipCount);
  if (railCheck.chipMinHeight < 48) throw new Error("rail chip min-height < 48px: " + railCheck.chipMinHeight);
  if (!railCheck.allOpaque) throw new Error("a rail chip has transparent background");
  if (!railCheck.activeFilled) throw new Error("active rail chip is not filled");
  const overflow390 = await page2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  note("p0_overflow390", overflow390);
  if (overflow390 > 0) throw new Error("horizontal overflow at 390px: " + overflow390);
  const canvasCheck = await page2.evaluate(() => {
    const img = document.getElementById("shellImg");
    const r = img.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), decoded: img.naturalWidth > 0 };
  });
  note("p0_canvas", canvasCheck);
  if (!canvasCheck.decoded || canvasCheck.h < 100) throw new Error("editor canvas photo not visible");
  await ctx2.close();

  // ── Konteks 3: desktop — layout TENGAH (arah Bobby 19 Nov 2026 11:52:
  // "jangan jadi sidebar, tetap grid di tengah"). TIDAK ADA sidebar;
  // kolom tengah 1024px, grid pemilih 4×2 (7 tile — contoh pindah ke
  // bawah dropzone), top bar editor dibatasi lebar kolom, toast +
  // maskot menempel tepi kanan kolom. Screenshot home/kartu/editor di
  // 1366×768, 1440×900, 1920×1080.
  mkdirSync("/home/hatch/workspace/sirna-desktop-audit", { recursive: true });
  for (const [w, h, tag] of [[1366, 768, "1366"], [1440, 900, "1440"], [1920, 1080, "1920"]]) {
    const ctxD = await browser.newContext({ viewport: { width: w, height: h }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
    const pd = await ctxD.newPage();
    pd.on("console", (m) => { if (m.type() === "error") consoleErrors.push("desk" + tag + ": " + m.text()); });
    pd.on("pageerror", (e) => pageErrors.push("desk" + tag + ": " + String(e)));
    await pd.goto(BASE, { waitUntil: "networkidle" });
    await pd.waitForTimeout(1000);
    // (D1) home: TIDAK ADA sidebar; pemilih alat hero TAMPIL; grid 4
    // kolom × 2 baris, 7 tile (tile contoh KELUAR dari grid — contoh
    // tinggal di bawah dropzone workspace, Fase 2), tinggi kartu rata
    // per baris; kolom tengah ~1024px sejajar header; tanpa overflow.
    const dHome = await pd.evaluate(() => {
      const main = document.querySelector("main").getBoundingClientRect();
      const hd = document.querySelector("header>div").getBoundingClientRect();
      const pk = document.getElementById("toolPicker");
      const tiles = Array.from(document.querySelectorAll("#toolPicker .tool-card"));
      const cols = getComputedStyle(pk).gridTemplateColumns.split(" ").length;
      const byRow = {};
      tiles.forEach((t) => { const y = Math.round(t.getBoundingClientRect().top); (byRow[y] = byRow[y] || []).push(Math.round(t.getBoundingClientRect().height)); });
      const rowSpread = Math.max(...Object.values(byRow).map((hs) => Math.max(...hs) - Math.min(...hs)));
      const lastRowCount = Object.values(byRow).pop().length;
      return {
        vw: window.innerWidth,
        noSidebar: !document.getElementById("deskSidebar"),
        pickerVisible: getComputedStyle(pk).display !== "none" && pk.getBoundingClientRect().width > 0,
        tiles: tiles.length,
        noSampleTile: !document.getElementById("sampleTile"),
        sampleInPanel: document.getElementById("sampleBtn").closest("#panel-cleaner") !== null,
        cols, rows: Object.keys(byRow).length, lastRowCount, rowSpread,
        mainW: Math.round(main.width), mainLeft: Math.round(main.left), mainRight: Math.round(main.right),
        headerInnerW: Math.round(hd.width),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    note("desk" + tag + "_home", dHome);
    if (!dHome.noSidebar) throw new Error("sidebar masih ada @" + tag);
    if (!dHome.pickerVisible) throw new Error("pemilih alat hero tidak tampil @" + tag);
    if (dHome.tiles !== 7) throw new Error("grid pemilih harus 7 tile (tanpa tile contoh), got " + dHome.tiles + " @" + tag);
    if (!dHome.noSampleTile) throw new Error("tile Coba foto contoh masih di grid @" + tag);
    if (!dHome.sampleInPanel) throw new Error("contoh tidak di bawah dropzone workspace @" + tag);
    if (dHome.cols !== 4) throw new Error("grid pemilih harus 4 kolom @" + tag + ", got " + dHome.cols);
    if (dHome.rows !== 2) throw new Error("grid pemilih harus 2 baris @" + tag + ", got " + dHome.rows);
    if (dHome.lastRowCount !== 3) throw new Error("baris terakhir grid harus 3 kartu @" + tag + ": " + dHome.lastRowCount + " kartu");
    if (dHome.rowSpread > 1) throw new Error("tinggi kartu tidak rata dalam baris @" + tag + ": spread " + dHome.rowSpread);
    if (dHome.mainW < 900 || dHome.mainW > 1060) throw new Error("lebar kolom tengah tidak masuk akal @" + tag + ": " + dHome.mainW);
    if (Math.abs(dHome.mainLeft - (dHome.vw - dHome.mainRight)) > 2) throw new Error("kolom tengah tidak rata tengah @" + tag);
    if (Math.abs(dHome.headerInnerW - dHome.mainW) > 2) throw new Error("header tidak sejajar kolom konten @" + tag);
    if (dHome.overflow > 0) throw new Error("horizontal overflow home @" + tag + ": " + dHome.overflow);
    await pd.screenshot({ path: "/home/hatch/workspace/sirna-desktop-audit/desktop-home-" + tag + ".png" });
    // (D2) pilih Bersihkan dulu lalu foto contoh: editor MENGGANTIKAN
    // home (hero hilang), kanvas kelihatan di viewport; kartu file
    // tetap terjangkau via scroll; toast TIDAK menutupi tombol Simpan
    // di top bar; FAQ tersembunyi di mode editor.
    await pd.click('[data-tool="clean"]');
    await pd.waitForTimeout(600);
    await clickSample(pd);
    await waitFor(pd, () => {
      const b = document.getElementById("primaryBtn");
      return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
    }, 30000);
    await pd.waitForTimeout(600);
    const dCard = await pd.evaluate(() => {
      const img = document.getElementById("shellImg").getBoundingClientRect();
      const b = document.getElementById("primaryBtn");
      const br = b.getBoundingClientRect();
      const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const toast = document.getElementById("toast");
      const tr = !toast.classList.contains("hidden") ? toast.getBoundingClientRect() : null;
      const main = document.querySelector("main").getBoundingClientRect();
      return {
        canvasVisible: img.width > 0 && img.height > 100 && img.top >= 0 && img.top < window.innerHeight,
        canvasTop: Math.round(img.top), vh: window.innerHeight,
        saveCenterHit: hit === b || b.contains(hit),
        saveHitTag: hit ? (hit.id || hit.className || hit.tagName) : null,
        toastOverlapSave: tr ? !(tr.bottom <= br.top || tr.top >= br.bottom || tr.right <= br.left || tr.left >= br.right) : false,
        toastRightEdge: tr ? Math.round(tr.right) : -1,
        mainRight: Math.round(main.right),
        cardCount: document.querySelectorAll("#list article").length,
        faqHidden: getComputedStyle(document.getElementById("faqSection")).display === "none",
        heroHidden: document.getElementById("heroSection").classList.contains("hidden"),
        panelShown: getComputedStyle(document.getElementById("panel-cleaner")).display !== "none",
      };
    });
    note("desk" + tag + "_card", dCard);
    if (!dCard.canvasVisible) throw new Error("kanvas editor tidak kelihatan di viewport @" + tag + " (top " + dCard.canvasTop + ", vh " + dCard.vh + ")");
    if (!dCard.saveCenterHit) throw new Error("tombol Simpan tertutup " + dCard.saveHitTag + " @" + tag);
    if (dCard.toastOverlapSave) throw new Error("toast menutupi tombol Simpan @" + tag);
    if (dCard.toastRightEdge !== -1 && Math.abs((dCard.mainRight - 24) - dCard.toastRightEdge) > 4) throw new Error("toast tidak menempel tepi kanan kolom @" + tag + " (toastRight " + dCard.toastRightEdge + ", mainRight " + dCard.mainRight + ")");
    if (dCard.cardCount !== 1) throw new Error("kartu file tidak ada setelah contoh @" + tag + ": " + dCard.cardCount);
    if (!dCard.faqHidden) throw new Error("FAQ masih tampil di mode editor @" + tag);
    if (!dCard.heroHidden) throw new Error("hero masih tampil di mode editor @" + tag);
    if (!dCard.panelShown) throw new Error("panel workspace tidak tampil setelah upload @" + tag);
    // Kartu file terjangkau: scroll ke kartu -> kelihatan.
    await pd.evaluate(() => document.querySelector("#list article").scrollIntoView({ block: "center" }));
    await pd.waitForTimeout(400);
    const cardSeen = await pd.evaluate(() => { const r = document.querySelector("#list article").getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
    note("desk" + tag + "_cardReachable", cardSeen);
    if (!cardSeen) throw new Error("kartu file tidak terjangkau via scroll @" + tag);
    await pd.screenshot({ path: "/home/hatch/workspace/sirna-desktop-audit/desktop-card-" + tag + ".png" });
    // (D3) editor kanonis satu kolom tengah: top bar editor selebar
    // kolom (bukan selebar layar), Simpan di baris atas, pengaturan
    // in-flow (bukan grid inspector), maskot menempel tepi kanan kolom
    // di atas dock (bottomGap 120–150px, Fase 2).
    await pd.evaluate(() => document.getElementById("editorHead").scrollIntoView({ block: "start" }));
    await pd.waitForTimeout(400);
    const dEd = await pd.evaluate(() => {
      const img = document.getElementById("shellImg").getBoundingClientRect();
      const bar = document.getElementById("editorTopBar").getBoundingClientRect();
      const btn = document.getElementById("primaryBtn").getBoundingClientRect();
      const pc = document.getElementById("panel-cleaner");
      const main = document.querySelector("main").getBoundingClientRect();
      const m = document.getElementById("mascotStage").getBoundingClientRect();
      return {
        canvasVisible: img.width > 0 && img.height > 100,
        topBarW: Math.round(bar.width),
        topBarLeftGap: Math.round(bar.left),
        topBarRightGap: Math.round(window.innerWidth - bar.right),
        topBarTop: Math.round(bar.top),
        saveTop: Math.round(btn.top),
        saveH: Math.round(btn.height),
        primaryLabel: document.getElementById("primaryBtn").textContent,
        panelDisplay: getComputedStyle(pc).display,
        settingsVisible: !document.getElementById("settingsCard").classList.contains("hidden"),
        mascotRightEdge: Math.round(m.right),
        mascotBottomGap: Math.round(window.innerHeight - m.bottom),
        mainRight: Math.round(main.right),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    note("desk" + tag + "_editor", dEd);
    if (!dEd.canvasVisible) throw new Error("canvas editor tidak kelihatan @" + tag);
    if (dEd.topBarW < 800 || dEd.topBarW > 1060) throw new Error("top bar editor bukan selebar kolom tengah @" + tag + ": " + dEd.topBarW);
    if (Math.abs(dEd.topBarLeftGap - dEd.topBarRightGap) > 4) throw new Error("top bar editor tidak rata tengah @" + tag + " (kiri " + dEd.topBarLeftGap + ", kanan " + dEd.topBarRightGap + ")");
    if (dEd.saveTop > 80) throw new Error("Simpan bukan di top bar @" + tag + ": top " + dEd.saveTop);
    if (dEd.saveH < 44) throw new Error("Simpan < 44px @" + tag + ": " + dEd.saveH);
    if (dEd.panelDisplay === "grid") throw new Error("panel masih grid inspector @" + tag);
    if (!dEd.settingsVisible) throw new Error("pengaturan tidak tampil di editor Bersihkan @" + tag);
    if (Math.abs((dEd.mainRight - 16) - dEd.mascotRightEdge) > 6) throw new Error("maskot tidak menempel tepi kanan kolom @" + tag + " (mascotRight " + dEd.mascotRightEdge + ", mainRight " + dEd.mainRight + ")");
    if (dEd.mascotBottomGap < 120 || dEd.mascotBottomGap > 150) throw new Error("maskot tidak di atas dock @" + tag + " (bottomGap " + dEd.mascotBottomGap + ")");
    if (dEd.overflow > 0) throw new Error("horizontal overflow editor @" + tag + ": " + dEd.overflow);
    await pd.screenshot({ path: "/home/hatch/workspace/sirna-desktop-audit/desktop-editor-" + tag + ".png" });
    await ctxD.close();
  }
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
await browser.close();
server.kill();
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
