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
/* Klik kontrol "Coba foto contoh" yang sedang tampil: tile #sampleTile
   (kartu ke-8 grid, desktop ≥1024px) atau pill #sampleBtn (HP). */
async function clickSample(pg){
  const sel = await pg.evaluate(() => {
    const t = document.getElementById("sampleTile");
    return (t && getComputedStyle(t).display !== "none") ? "#sampleTile" : "#sampleBtn";
  });
  await pg.click(sel);
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
  note("pickerCards", await page.evaluate(() => Array.from(document.querySelectorAll("#toolPicker .tool-card")).map((c) => c.dataset.tool).filter(Boolean).join(",")));
  note("panelHidden", await page.evaluate(() => document.getElementById("panel-cleaner").classList.contains("hidden")));
  note("noActiveChip", await page.evaluate(() => document.querySelectorAll("[data-tool-switch].active").length));
  note("primaryHidden", await page.evaluate(() => document.getElementById("primaryBar").classList.contains("hidden")));
  note("editorHeadHidden", await page.evaluate(() => document.getElementById("editorHead").classList.contains("hidden")));
  note("sampleControl", await page.evaluate(() => { const t = document.getElementById("sampleTile"); return (t && getComputedStyle(t).display !== "none") ? "tile" : "pill"; }));

  // (2) Coba foto contoh: file diantre, banner muncul, TIDAK ada alat jalan.
  await clickSample(page);
  await waitFor(page, () => !document.getElementById("sampleBanner").classList.contains("hidden"), 10000);
  await page.waitForTimeout(400);
  note("sampleBanner", await page.locator("#sampleBanner").textContent());
  note("sampleToast", await page.locator("#toast").textContent());
  note("panelStillHidden", await page.evaluate(() => document.getElementById("panel-cleaner").classList.contains("hidden")));
  note("noActiveChipAfterSample", await page.evaluate(() => document.querySelectorAll("[data-tool-switch].active").length));
  note("primaryStillHidden", await page.evaluate(() => document.getElementById("primaryBar").classList.contains("hidden")));

  // (3) Pilih Bersihkan: workspace + kepala editor muncul; alat JALAN
  // SENDIRI (prinsip A) — tunggu tombol utama jadi "Simpan foto".
  await page.click('[data-tool="clean"]');
  await waitFor(page, () => {
    const b = document.getElementById("primaryBtn");
    return b && !document.getElementById("primaryBar").classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, 30000);
  await page.waitForTimeout(400);
  note("editorHeadVisible", await page.evaluate(() => !document.getElementById("editorHead").classList.contains("hidden")));
  note("shellPillAfterAutoClean", await page.locator("#shellPill").textContent());
  note("shellStatusAfterAutoClean", await page.locator("#shellStatus").textContent());
  note("shellImgSize", await page.evaluate(() => { const i = document.getElementById("shellImg"); return [i.naturalWidth, i.naturalHeight]; }));
  note("filmThumbs", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb").length));
  note("filmActive", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb.active").length));
  note("shellVersionsVisible", await page.evaluate(() => !document.getElementById("shellVersions").classList.contains("hidden")));
  note("shellUndoAbsent", await page.evaluate(() => !document.getElementById("shellUndo"))); // satu undo: chip Versi (prinsip I)
  note("primaryLabelClean", await page.locator("#primaryBtn").textContent());
  note("topBackVisible", await page.evaluate(() => !document.getElementById("topBackBtn").classList.contains("hidden")));
  note("topExportAbsent", await page.evaluate(() => !document.getElementById("topExportBtn"))); // satu jalur simpan (prinsip C)

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
  await waitFor(page2, () => {
    const b = document.getElementById("primaryBtn");
    return b && !document.getElementById("primaryBar").classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, 30000);
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
  const pBtn = await page2.locator("#primaryBtn").boundingBox();
  const vh = page2.viewportSize().height;
  note("p0_primaryBtnBottom", Math.round(pBtn.y + pBtn.height));
  note("p0_viewportHeight", vh);
  if (pBtn.y + pBtn.height > vh - 20) throw new Error("primary button clipped: bottom " + Math.round(pBtn.y + pBtn.height) + " > vh-20 " + (vh - 20));
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
  if (railCheck.toolBarChipCount !== 8) throw new Error("toolBar harus 8 chip (7 alat + Semua alat), got " + railCheck.toolBarChipCount);
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
  // kolom tengah 1024px, grid pemilih 4×2 (7 alat + tile Coba foto
  // contoh), bar utama dibatasi lebar kolom, toast + maskot menempel
  // tepi kanan kolom. Screenshot home/kartu/editor di 1366×768,
  // 1440×900, 1920×1080.
  mkdirSync("/home/hatch/workspace/sirna-desktop-audit", { recursive: true });
  for (const [w, h, tag] of [[1366, 768, "1366"], [1440, 900, "1440"], [1920, 1080, "1920"]]) {
    const ctxD = await browser.newContext({ viewport: { width: w, height: h }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
    const pd = await ctxD.newPage();
    pd.on("console", (m) => { if (m.type() === "error") consoleErrors.push("desk" + tag + ": " + m.text()); });
    pd.on("pageerror", (e) => pageErrors.push("desk" + tag + ": " + String(e)));
    await pd.goto(BASE, { waitUntil: "networkidle" });
    await pd.waitForTimeout(1000);
    // (D1) home: TIDAK ADA sidebar; pemilih alat hero TAMPIL; grid 4
    // kolom × 2 baris (8 tile), tinggi kartu rata per baris; kolom
    // tengah ~1024px sejajar header; tanpa overflow.
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
        sampleTileVisible: getComputedStyle(document.getElementById("sampleTile")).display !== "none",
        sampleRowHidden: getComputedStyle(document.getElementById("sampleRow")).display === "none",
        cols, rows: Object.keys(byRow).length, lastRowCount, rowSpread,
        mainW: Math.round(main.width), mainLeft: Math.round(main.left), mainRight: Math.round(main.right),
        headerInnerW: Math.round(hd.width),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    note("desk" + tag + "_home", dHome);
    if (!dHome.noSidebar) throw new Error("sidebar masih ada @" + tag);
    if (!dHome.pickerVisible) throw new Error("pemilih alat hero tidak tampil @" + tag);
    if (dHome.tiles !== 8) throw new Error("grid pemilih harus 8 tile (7 alat + contoh), got " + dHome.tiles + " @" + tag);
    if (!dHome.sampleTileVisible) throw new Error("tile Coba foto contoh tidak tampil @" + tag);
    if (!dHome.sampleRowHidden) throw new Error("baris pill contoh masih tampil di desktop @" + tag);
    if (dHome.cols !== 4) throw new Error("grid pemilih harus 4 kolom @" + tag + ", got " + dHome.cols);
    if (dHome.rows !== 2) throw new Error("grid pemilih harus 2 baris @" + tag + ", got " + dHome.rows);
    if (dHome.lastRowCount !== 4) throw new Error("baris terakhir grid yatim @" + tag + ": " + dHome.lastRowCount + " kartu");
    if (dHome.rowSpread > 1) throw new Error("tinggi kartu tidak rata dalam baris @" + tag + ": spread " + dHome.rowSpread);
    if (dHome.mainW < 900 || dHome.mainW > 1060) throw new Error("lebar kolom tengah tidak masuk akal @" + tag + ": " + dHome.mainW);
    if (Math.abs(dHome.mainLeft - (dHome.vw - dHome.mainRight)) > 2) throw new Error("kolom tengah tidak rata tengah @" + tag);
    if (Math.abs(dHome.headerInnerW - dHome.mainW) > 2) throw new Error("header tidak sejajar kolom konten @" + tag);
    if (dHome.overflow > 0) throw new Error("horizontal overflow home @" + tag + ": " + dHome.overflow);
    await pd.screenshot({ path: "/home/hatch/workspace/sirna-desktop-audit/desktop-home-" + tag + ".png" });
    // (D2) upload foto contoh: kartu file kelihatan di viewport TANPA
    // scroll melewati FAQ; toast tidak menutupi judul FAQ; toast menempel
    // tepi kanan kolom (bukan tepi viewport).
    await clickSample(pd);
    await waitFor(pd, () => !document.getElementById("sampleBanner").classList.contains("hidden"), 10000);
    await pd.waitForTimeout(600);
    const dCard = await pd.evaluate(() => {
      const card = document.querySelector("#list article");
      const r = card ? card.getBoundingClientRect() : null;
      const faq = document.querySelector("#faqSection h2").getBoundingClientRect();
      const toast = document.getElementById("toast");
      const tr = !toast.classList.contains("hidden") ? toast.getBoundingClientRect() : null;
      const main = document.querySelector("main").getBoundingClientRect();
      const overlap = tr ? !(tr.bottom <= faq.top || tr.top >= faq.bottom || tr.right <= faq.left || tr.left >= faq.right) : false;
      return {
        cardVisible: !!r && r.top >= 0 && r.bottom <= window.innerHeight && r.height > 100,
        cardTop: r ? Math.round(r.top) : -1, cardBottom: r ? Math.round(r.bottom) : -1, cardH: r ? Math.round(r.height) : -1, vh: window.innerHeight,
        faqTop: Math.round(faq.top),
        toastOverlapFaq: overlap,
        toastRightEdge: tr ? Math.round(tr.right) : -1,
        mainRight: Math.round(main.right),
        panelShown: getComputedStyle(document.getElementById("panel-cleaner")).display !== "none",
      };
    });
    note("desk" + tag + "_card", dCard);
    if (!dCard.cardVisible) throw new Error("kartu file tidak kelihatan di viewport @" + tag + " (top " + dCard.cardTop + ", bottom " + dCard.cardBottom + ", vh " + dCard.vh + ")");
    if (dCard.toastOverlapFaq) throw new Error("toast menutupi judul FAQ @" + tag);
    if (dCard.toastRightEdge !== -1 && Math.abs((dCard.mainRight - 24) - dCard.toastRightEdge) > 4) throw new Error("toast tidak menempel tepi kanan kolom @" + tag + " (toastRight " + dCard.toastRightEdge + ", mainRight " + dCard.mainRight + ")");
    if (!dCard.panelShown) throw new Error("panel workspace tidak tampil setelah upload @" + tag);
    await pd.screenshot({ path: "/home/hatch/workspace/sirna-desktop-audit/desktop-card-" + tag + ".png" });
    // (D3) pilih Bersihkan lewat kartu pemilih -> editor kanonis satu
    // kolom tengah: canvas kelihatan, bar utama = bar bawah DIBATASI
    // lebar kolom (bukan selebar layar, bukan pil melayang), tombol
    // terlihat penuh, pengaturan in-flow (bukan grid inspector), maskot
    // menempel tepi kanan kolom di atas toast.
    await pd.click('[data-tool="clean"]');
    await waitFor(pd, () => {
      const b = document.getElementById("primaryBtn");
      return b && !document.getElementById("primaryBar").classList.contains("hidden") && b.textContent.includes("Simpan foto");
    }, 30000);
    await pd.waitForTimeout(500);
    const dEd = await pd.evaluate(() => {
      const img = document.getElementById("shellImg").getBoundingClientRect();
      const bar = document.getElementById("primaryBar").getBoundingClientRect();
      const btn = document.getElementById("primaryBtn").getBoundingClientRect();
      const pc = document.getElementById("panel-cleaner");
      const main = document.querySelector("main").getBoundingClientRect();
      const m = document.getElementById("mascotStage").getBoundingClientRect();
      return {
        canvasVisible: img.width > 0 && img.height > 100,
        barW: Math.round(bar.width),
        barLeftGap: Math.round(bar.left),
        barRightGap: Math.round(window.innerWidth - bar.right),
        barBottomGap: Math.round(window.innerHeight - bar.bottom),
        btnBottomGap: Math.round(window.innerHeight - btn.bottom),
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
    if (dEd.barW < 800 || dEd.barW > 1060) throw new Error("bar utama bukan selebar kolom tengah @" + tag + ": " + dEd.barW);
    if (Math.abs(dEd.barLeftGap - dEd.barRightGap) > 4) throw new Error("bar utama tidak rata tengah @" + tag + " (kiri " + dEd.barLeftGap + ", kanan " + dEd.barRightGap + ")");
    if (dEd.barBottomGap !== 0) throw new Error("bar utama tidak menempel bawah @" + tag + ": " + dEd.barBottomGap);
    if (dEd.btnBottomGap < 20) throw new Error("tombol utama tidak terlihat penuh @" + tag + " (gap " + dEd.btnBottomGap + ")");
    if (dEd.panelDisplay === "grid") throw new Error("panel masih grid inspector @" + tag);
    if (!dEd.settingsVisible) throw new Error("pengaturan tidak tampil di editor Bersihkan @" + tag);
    if (Math.abs((dEd.mainRight - 16) - dEd.mascotRightEdge) > 6) throw new Error("maskot tidak menempel tepi kanan kolom @" + tag + " (mascotRight " + dEd.mascotRightEdge + ", mainRight " + dEd.mainRight + ")");
    if (dEd.mascotBottomGap < 140 || dEd.mascotBottomGap > 200) throw new Error("maskot tidak di atas toast/bar @" + tag + " (bottomGap " + dEd.mascotBottomGap + ")");
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
