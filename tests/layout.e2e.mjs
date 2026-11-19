// Layout kanonis file-first (19 Nov 2026, 3 alat tanpa model):
// home = dropzone besar + contoh di bawahnya (tanpa pemilih alat) ->
// upload dari home -> editor terbuka, Bersihkan JALAN SENDIRI ->
// editor kanonis (filmstrip + canvas + status + versi + rail scroll +
// tombol utama sticky "Simpan foto") -> chaining lewat rail -> Back ->
// "Buka editor" -> sheet konfirmasi. + 390px tanpa overflow.
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
/* Klik "Coba foto contoh": thumbnail DI BAWAH dropzone home —
   klik = file contoh masuk dari home + Bersihkan langsung jalan. */
async function clickSample(pg) {
  await pg.click("#sampleBtn");
}
/* Simpan di top bar editor terlihat + bisa diketuk: tombolnya di dalam
   viewport, tidak tertutup toast / maskot / dock. */
async function assertSaveTappable(pg, tag) {
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

  // (1) Home file-first: dropzone kelihatan di viewport tanpa scroll,
  // TIDAK ADA #toolPicker di DOM, contoh tepat di bawah dropzone.
  // Simpan di top bar sembunyi (belum ada hasil).
  note("h1", await page.locator("h1").textContent());
  note("toolPickerAbsent", await page.evaluate(() => !document.getElementById("toolPicker")));
  note("dropzoneInHero", await page.evaluate(() => document.getElementById("dropZone").closest("#heroSection") !== null));
  note("dropzoneVisibleNoScroll", await page.evaluate(() => { const r = document.getElementById("dropZone").getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }));
  note("sampleRowBelowDropzone", await page.evaluate(() => { const d = document.getElementById("dropZone").getBoundingClientRect(), s = document.getElementById("sampleRow").getBoundingClientRect(); return s.top >= d.bottom - 1; }));
  note("panelHidden", await page.evaluate(() => document.getElementById("panel-cleaner").classList.contains("hidden")));
  note("noActiveChip", await page.evaluate(() => document.querySelectorAll("[data-tool-switch].active").length));
  note("primaryHidden", await page.evaluate(() => document.getElementById("primaryBtn").classList.contains("hidden")));
  note("editorHeadHidden", await page.evaluate(() => document.getElementById("editorHead").classList.contains("hidden")));
  note("sampleInHero", await page.evaluate(() => document.getElementById("sampleBtn").closest("#heroSection") !== null));
  note("noStickyBottomBar", await page.evaluate(() => !document.getElementById("primaryBar")));
  note("siteHeaderVisible", await page.evaluate(() => getComputedStyle(document.querySelector("header")).display !== "none"));
  note("historyVisibleHome", await page.evaluate(() => !document.getElementById("historySection").classList.contains("hidden")));

  // (2) MIGRASI TOTAL — File dari home: editor TERBUKA, Bersihkan JALAN
  // OTOMATIS, tombol utama "Simpan foto" muncul (dulu: file diantre +
  // banner "pilih alat dulu", panel tetap tersembunyi).
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await waitFor(page, () => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, 30000);
  await page.waitForTimeout(400);
  note("editorOpened", await page.evaluate(() => !document.getElementById("panel-cleaner").classList.contains("hidden") && document.getElementById("heroSection").classList.contains("hidden")));
  note("cleanChipActive", await page.evaluate(() => document.querySelector('[data-tool-switch="clean"]').classList.contains("active")));
  note("primaryAfterClean", await page.evaluate(() => document.getElementById("primaryBtn").textContent.trim()));

  // (3) Editor MENGGANTIKAN home (hero hilang, header situs hilang,
  // top bar editor tampil); alat JALAN SENDIRI (prinsip A) — tombol
  // Simpan di top bar sudah "Simpan foto" sejak langkah (2).
  note("heroHiddenInEditor", await page.evaluate(() => document.getElementById("heroSection").classList.contains("hidden")));
  note("historyHiddenInEditor", await page.evaluate(() => document.getElementById("historySection").classList.contains("hidden")));
  note("siteHeaderHiddenInEditor", await page.evaluate(() => getComputedStyle(document.querySelector("header")).display === "none"));
  note("editorTopBarVisible", await page.evaluate(() => { const t = document.getElementById("editorTopBar"); const r = t.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.top < 80; }));
  note("editorTopBarSticky", await page.evaluate(() => getComputedStyle(document.getElementById("editorTopBar")).position === "sticky"));
  note("editorHeadVisible", await page.evaluate(() => !document.getElementById("editorHead").classList.contains("hidden")));
  note("dropZoneHiddenWithFile", await page.evaluate(() => !document.getElementById("dropZone").offsetParent)); // dropzone ikut hilang bersama hero (editor-on)
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
  note("shellPillAfterAsli", await page.locator("#shellPill").textContent());
  note("primaryLabelAfterAsli", await page.locator("#primaryBtn").textContent());

  // (7) Chaining lewat rail: ganti ke Hapus Watermark — auto-run v1
  // (tanpa modal kuas), foto & hasil Bersihkan ikut; tombol utama tetap
  // "Simpan foto" karena hasil Bersihkan sudah ada.
  await page.click('[data-tool-switch="watermark"]');
  await waitFor(page, () => {
    const t = document.getElementById("shellResult")?.textContent || "";
    return t.includes("Tidak ketemu tanda watermark") || t.includes("bukan pola Gemini") || t.includes("Sparkle Gemini dihapus");
  }, 10000);
  note("wmModalAbsent", await page.evaluate(() => !document.getElementById("eraseModal")));
  note("wmResult", await page.locator("#shellResult").textContent());
  await page.waitForTimeout(600);
  note("primaryLabelWatermark", await page.locator("#primaryBtn").textContent());
  note("shellImgStillSame", await page.evaluate(() => { const i = document.getElementById("shellImg"); return [i.naturalWidth, i.naturalHeight]; }));
  note("filmKeptAfterSwitch", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb").length));
  if ((await page.locator("#primaryBtn").textContent()).trim() !== "Simpan foto") throw new Error("primary harus tetap 'Simpan foto' setelah switch ke watermark (hasil Bersihkan ada)");

  // (8) Sheet konfirmasi: Batal = tidak jadi; Konfirmasi = mulai ulang.
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  note("sheetVisible", await page.evaluate(() => !document.getElementById("sheet").classList.contains("hidden")));
  note("sheetTitle", await page.locator("#sheetTitle").textContent());
  await page.click("#sheetCancel");
  await page.waitForTimeout(400);
  note("sheetHiddenAfterCancel", await page.evaluate(() => document.getElementById("sheet").classList.contains("hidden")));
  note("filmKeptAfterCancel", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb").length));
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  await page.click("#sheetConfirm");
  await page.waitForTimeout(600);
  note("pickerAfterRestart", await page.evaluate(() => !document.getElementById("heroSection").classList.contains("hidden")));
  note("filmAfterRestart", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb").length));
  if (await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb").length) !== 0) throw new Error("filmstrip masih menampilkan thumb basi setelah Mulai ulang");

  // (9) Tombol "‹ Back" di top bar editor (dengan file) -> home;
  // #queueHint terlihat; header situs muncul lagi; klik "Buka editor"
  // -> editor kembali dengan antrean utuh. (Tidak ada lagi jalur
  // "pilih alat tanpa file".) Langkah (8) tadi me-restart antrean jadi
  // kosong — upload 1 file dulu supaya editor terbuka lagi.
  await page.setInputFiles("#fileInput", ["/home/hatch/workspace/sirna-vite/tests/fixtures/matrix/png-text.png"]);
  await waitFor(page, () => { const p = document.getElementById("shellPill"); return p && p.textContent.trim() === "Sudah bersih"; }, 15000);
  note("editorBackVisibleWithFile", await page.evaluate(() => { const b = document.getElementById("editorBackBtn"); const r = b.getBoundingClientRect(); return r.width > 0 && r.height >= 44; }));
  note("siteHeaderHiddenWithFile", await page.evaluate(() => getComputedStyle(document.querySelector("header")).display === "none"));
  await page.click("#editorBackBtn");
  await page.waitForTimeout(500);
  note("pickerAfterTopBack", await page.evaluate(() => !document.getElementById("heroSection").classList.contains("hidden")));
  note("queueHintAfterBack", await page.evaluate(() => !document.getElementById("queueHint").classList.contains("hidden")));
  note("queueHintTextAfterBack", await page.evaluate(() => document.getElementById("queueHintText")?.textContent?.trim()));
  note("siteHeaderBackAfterBack", await page.evaluate(() => getComputedStyle(document.querySelector("header")).display !== "none"));
  await page.click("#resumeBtn");
  await page.waitForTimeout(500);
  note("editorBackAfterResume", await page.evaluate(() => !document.getElementById("panel-cleaner").classList.contains("hidden")));
  note("filmKeptAfterResume", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb").length));
  // Kembali ke home untuk langkah (10): restart dulu (antrean kosong).
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  await page.click("#sheetConfirm");
  await page.waitForTimeout(600);

  // (10) Foto contoh dari bawah dropzone home: klik thumbnail LANGSUNG
  // (tanpa pilih alat) -> editor + auto-clean -> "Simpan foto".
  note("sampleRowVisible", await page.evaluate(() => { const r = document.getElementById("sampleRow"); return !r.classList.contains("hidden") && r.offsetParent !== null; }));
  note("sampleThumbLoaded", await page.evaluate(async () => { const img = document.getElementById("sampleThumbImg"); for (let i = 0; i < 30 && !img.src; i++) await new Promise((r) => setTimeout(r, 100)); return !!img.src && img.naturalWidth > 0; }));
  await clickSample(page);
  await waitFor(page, () => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, 30000);
  await page.waitForTimeout(400);
  note("sampleAutoCleanPill", await page.locator("#shellPill").textContent());
  note("sampleRowHiddenWithFile", await page.evaluate(() => !document.getElementById("sampleRow").offsetParent)); // contoh ikut hilang bersama hero (editor-on)
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
  // File-first 390px: upload langsung dari home membuka editor.
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
  // gesture bar + editor terlihat setelah upload. Screenshot (a)
  // filmstrip, (b) kepala editor — dilihat manual.
  await page2.evaluate(() => document.getElementById("shellFilm").scrollIntoView({ block: "start" }));
  await page2.waitForTimeout(600);
  await page2.screenshot({ path: "/home/hatch/workspace/sirna-p0-fix/card-390.png" });
  note("shotCard", "sirna-p0-fix/card-390.png");
  await page2.evaluate(() => document.getElementById("editorHead").scrollIntoView({ block: "start" }));
  await page2.waitForTimeout(600);
  await page2.screenshot({ path: "/home/hatch/workspace/sirna-p0-fix/editor-390.png" });
  note("shotEditor", "sirna-p0-fix/editor-390.png");
  // Hard assertions — gagal = throw, bukan cuma log.
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
    const bars = Array.from(document.querySelectorAll(".tool-bar"));
    const bar = document.getElementById("toolBar");
    const chips = Array.from(bar.querySelectorAll(".tool-chip"));
    return {
      toolBarCount: bars.length, // SATU rail: cuma kepala editor (prinsip E)
      oldRail: document.querySelectorAll(".tool-rail").length,
      toolBarChipCount: chips.length,
      chipMinHeight: Math.min(...chips.map((c) => Math.round(c.getBoundingClientRect().height))),
      allOpaque: chips.every((c) => { const bg = getComputedStyle(c).backgroundColor; return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent"; }),
      activeFilled: (() => { const a = bar.querySelector(".tool-chip.active"); if (!a) return false; const bg = getComputedStyle(a).backgroundColor; return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent"; })(),
      labels: chips.map((c) => c.textContent.trim()).join("|"),
    };
  });
  note("p0_cardRail", railCheck);
  if (railCheck.toolBarCount !== 1) throw new Error("harus SATU .tool-bar (kepala editor), got " + railCheck.toolBarCount);
  if (railCheck.oldRail) throw new Error("old .tool-rail still present");
  if (railCheck.toolBarChipCount !== 3) throw new Error("toolBar harus 3 chip (pivot: clean/meta/watermark), got " + railCheck.toolBarChipCount);
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
  // kolom tengah 1024px, dropzone hero di home (tanpa pemilih alat),
  // top bar editor dibatasi lebar kolom, toast menempel tepi kanan
  // kolom. Screenshot home/kartu/editor di 1366×768, 1440×900, 1920×1080.
  mkdirSync("/home/hatch/workspace/sirna-desktop-audit", { recursive: true });
  for (const [w, h, tag] of [[1366, 768, "1366"], [1440, 900, "1440"], [1920, 1080, "1920"]]) {
    const ctxD = await browser.newContext({ viewport: { width: w, height: h }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
    const pd = await ctxD.newPage();
    pd.on("console", (m) => { if (m.type() === "error") consoleErrors.push("desk" + tag + ": " + m.text()); });
    pd.on("pageerror", (e) => pageErrors.push("desk" + tag + ": " + String(e)));
    await pd.goto(BASE, { waitUntil: "networkidle" });
    await pd.waitForTimeout(1000);
    // (D1) home file-first: TIDAK ADA sidebar; TIDAK ADA pemilih alat;
    // dropzone hero TAMPIL di viewport tanpa scroll, contoh tepat di
    // bawah dropzone; kolom tengah ~1024px sejajar header; tanpa overflow.
    const dHome = await pd.evaluate(() => {
      const main = document.querySelector("main").getBoundingClientRect();
      const hd = document.querySelector("header>div").getBoundingClientRect();
      const dz = document.getElementById("dropZone").getBoundingClientRect();
      const sr = document.getElementById("sampleRow").getBoundingClientRect();
      return {
        vw: window.innerWidth,
        noSidebar: !document.getElementById("deskSidebar"),
        toolPickerAbsent: !document.getElementById("toolPicker"),
        dropzoneVisible: dz.width > 0 && dz.top >= 0 && dz.bottom <= window.innerHeight,
        dropzoneInHero: document.getElementById("dropZone").closest("#heroSection") !== null,
        sampleBelowDropzone: sr.top >= dz.bottom - 1,
        sampleInHero: document.getElementById("sampleBtn").closest("#heroSection") !== null,
        mainW: Math.round(main.width), mainLeft: Math.round(main.left), mainRight: Math.round(main.right),
        headerInnerW: Math.round(hd.width),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    note("desk" + tag + "_home", dHome);
    if (!dHome.noSidebar) throw new Error("sidebar masih ada @" + tag);
    if (!dHome.toolPickerAbsent) throw new Error("pemilih alat masih ada @" + tag);
    if (!dHome.dropzoneVisible) throw new Error("dropzone hero tidak tampil di viewport @" + tag);
    if (!dHome.dropzoneInHero) throw new Error("dropzone tidak di dalam hero @" + tag);
    if (!dHome.sampleBelowDropzone) throw new Error("contoh tidak di bawah dropzone @" + tag);
    if (!dHome.sampleInHero) throw new Error("contoh tidak di hero @" + tag);
    if (dHome.mainW < 900 || dHome.mainW > 1060) throw new Error("lebar kolom tengah tidak masuk akal @" + tag + ": " + dHome.mainW);
    if (Math.abs(dHome.mainLeft - (dHome.vw - dHome.mainRight)) > 2) throw new Error("kolom tengah tidak rata tengah @" + tag);
    if (Math.abs(dHome.headerInnerW - dHome.mainW) > 2) throw new Error("header tidak sejajar kolom konten @" + tag);
    if (dHome.overflow > 0) throw new Error("horizontal overflow home @" + tag + ": " + dHome.overflow);
    await pd.screenshot({ path: "/home/hatch/workspace/sirna-desktop-audit/desktop-home-" + tag + ".png" });
    // (D2) foto contoh langsung dari home: editor MENGGANTIKAN home
    // (hero hilang), kanvas kelihatan di viewport; filmstrip terjangkau
    // via scroll; toast TIDAK menutupi tombol Simpan di top bar; FAQ
    // tersembunyi di mode editor.
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
        filmCount: document.querySelectorAll("#shellFilm .shell-thumb").length,
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
    if (dCard.filmCount !== 1) throw new Error("filmstrip tidak ada setelah contoh @" + tag + ": " + dCard.filmCount);
    if (!dCard.faqHidden) throw new Error("FAQ masih tampil di mode editor @" + tag);
    if (!dCard.heroHidden) throw new Error("hero masih tampil di mode editor @" + tag);
    if (!dCard.panelShown) throw new Error("panel workspace tidak tampil setelah upload @" + tag);
    // Filmstrip terjangkau: scroll ke sana -> kelihatan.
    await pd.evaluate(() => document.getElementById("shellFilm").scrollIntoView({ block: "center" }));
    await pd.waitForTimeout(400);
    const filmSeen = await pd.evaluate(() => { const r = document.getElementById("shellFilm").getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
    note("desk" + tag + "_filmReachable", filmSeen);
    if (!filmSeen) throw new Error("filmstrip tidak terjangkau via scroll @" + tag);
    await pd.screenshot({ path: "/home/hatch/workspace/sirna-desktop-audit/desktop-card-" + tag + ".png" });
    // (D3) editor kanonis satu kolom tengah: top bar editor selebar
    // kolom (bukan selebar layar), Simpan di baris atas, pengaturan
    // in-flow (bukan grid inspector). Maskot pivot cuma tampil saat
    // proses jalan — setelah bersih dia sembunyi, jadi tidak diasersi
    // di sini (lihat workflow: dock + mascot saat proses).
    await pd.evaluate(() => document.getElementById("editorHead").scrollIntoView({ block: "start" }));
    await pd.waitForTimeout(400);
    const dEd = await pd.evaluate(() => {
      const img = document.getElementById("shellImg").getBoundingClientRect();
      const bar = document.getElementById("editorTopBar").getBoundingClientRect();
      const btn = document.getElementById("primaryBtn").getBoundingClientRect();
      const pc = document.getElementById("panel-cleaner");
      const main = document.querySelector("main").getBoundingClientRect();
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
if (log.some(([k]) => k === "ERROR")) process.exitCode = 1;
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
