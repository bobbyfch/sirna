// Layout kanonis Phase 2 (19 Nov 2026, arah Bobby 08:49 WIB):
// home = pemilih alat (tanpa default) -> "Coba foto contoh" cuma mengantre
// (tidak ada alat yang jalan otomatis) -> pilih alat -> editor kanonis
// (filmstrip + canvas + status + versi + rail scroll + tombol utama sticky)
// -> chaining lewat rail -> sheet konfirmasi. + 390px tanpa overflow.
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
  await page.click('[data-sidebar-tool="clean"]');
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
  await page.click('[data-sidebar-tool="erase"]');
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

  // (10) P0 fix 19 Nov 2026 (screenshot POCO F6 Bobby): rel kartu kanonis
  // + tombol utama tidak terpotong gesture bar + editor terlihat setelah
  // pilih alat. Screenshot (a) kartu file, (b) kepala editor — dilihat manual.
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
    const rail = document.querySelector("#list article .tool-bar");
    if (!rail) return { hasRail: false };
    const chips = Array.from(rail.querySelectorAll(".tool-chip"));
    return {
      hasRail: true, chipCount: chips.length,
      oldRail: document.querySelectorAll("#list .tool-rail").length,
      chipMinHeight: Math.min(...chips.map((c) => Math.round(c.getBoundingClientRect().height))),
      allOpaque: chips.every((c) => { const bg = getComputedStyle(c).backgroundColor; return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent"; }),
      activeFilled: (() => { const a = rail.querySelector(".tool-chip.active"); if (!a) return false; const bg = getComputedStyle(a).backgroundColor; return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent"; })(),
      labels: chips.map((c) => c.textContent.trim()).join("|"),
    };
  });
  note("p0_cardRail", railCheck);
  if (!railCheck.hasRail) throw new Error("card rail .tool-bar missing");
  if (railCheck.oldRail) throw new Error("old .tool-rail still present in card");
  if (railCheck.chipCount !== 7) throw new Error("card rail must have 7 chips, got " + railCheck.chipCount);
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

  // ── Konteks 3: desktop — komposisi app shell (§02, R06+R18).
  // Sidebar ≥1024, workspace focal, toast/pil/maskot menempel workspace.
  // Screenshot home/kartu/editor di 1366×768, 1440×900, 1920×1080.
  mkdirSync("/home/hatch/workspace/sirna-desktop-audit", { recursive: true });
  for (const [w, h, tag] of [[1366, 768, "1366"], [1440, 900, "1440"], [1920, 1080, "1920"]]) {
    const ctxD = await browser.newContext({ viewport: { width: w, height: h }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
    const pd = await ctxD.newPage();
    pd.on("console", (m) => { if (m.type() === "error") consoleErrors.push("desk" + tag + ": " + m.text()); });
    pd.on("pageerror", (e) => pageErrors.push("desk" + tag + ": " + String(e)));
    await pd.goto(BASE, { waitUntil: "networkidle" });
    await pd.waitForTimeout(1000);
    // (D1) home: sidebar tampil (8 baris: Semua alat + 7 alat, tinggi
    // rata), pemilih alat hero sembunyi, header membentang, tanpa overflow.
    const dHome = await pd.evaluate(() => {
      const sb = document.getElementById("deskSidebar").getBoundingClientRect();
      const pk = document.getElementById("toolPicker");
      const hd = document.querySelector("header>div").getBoundingClientRect();
      const rows = Array.from(document.querySelectorAll("#deskSidebar .ds-tool")).map((el) => Math.round(el.getBoundingClientRect().height));
      return {
        sidebarVisible: sb.width > 0, sidebarW: Math.round(sb.width),
        pickerHidden: getComputedStyle(pk).display === "none",
        headerInnerW: Math.round(hd.width),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sidebarTools: document.querySelectorAll("#deskSidebar [data-sidebar-tool]").length,
        rowHMin: Math.min(...rows), rowHMax: Math.max(...rows),
      };
    });
    note("desk" + tag + "_home", dHome);
    if (!dHome.sidebarVisible) throw new Error("sidebar desktop tidak tampil @" + tag);
    if (!dHome.pickerHidden) throw new Error("pemilih alat hero masih tampil @" + tag);
    if (dHome.overflow > 0) throw new Error("horizontal overflow home @" + tag + ": " + dHome.overflow);
    if (dHome.sidebarTools !== 8) throw new Error("sidebar harus 8 baris (Semua alat + 7 alat), got " + dHome.sidebarTools);
    if (dHome.rowHMax - dHome.rowHMin > 1) throw new Error("tinggi baris sidebar tidak rata @" + tag + ": " + dHome.rowHMin + "-" + dHome.rowHMax);
    if (dHome.headerInnerW < 1180) throw new Error("header masih selebar kolom HP @" + tag + ": " + dHome.headerInnerW);
    await pd.screenshot({ path: "/home/hatch/workspace/sirna-desktop-audit/desktop-home-" + tag + ".png" });
    // (D2) upload foto contoh: kartu file kelihatan di viewport TANPA
    // scroll melewati FAQ; toast tidak menutupi judul FAQ; daftar file
    // sidebar berisi 1 file.
    await pd.click("#sampleBtn");
    await waitFor(pd, () => !document.getElementById("sampleBanner").classList.contains("hidden"), 10000);
    await pd.waitForTimeout(600);
    const dCard = await pd.evaluate(() => {
      const card = document.querySelector("#list article");
      const r = card ? card.getBoundingClientRect() : null;
      const faq = document.querySelector("#faqSection h2").getBoundingClientRect();
      const toast = document.getElementById("toast");
      const tr = !toast.classList.contains("hidden") ? toast.getBoundingClientRect() : null;
      const overlap = tr ? !(tr.bottom <= faq.top || tr.top >= faq.bottom || tr.right <= faq.left || tr.left >= faq.right) : false;
      return {
        cardVisible: !!r && r.top >= 0 && r.bottom <= window.innerHeight && r.height > 100,
        cardTop: r ? Math.round(r.top) : -1, cardBottom: r ? Math.round(r.bottom) : -1, cardH: r ? Math.round(r.height) : -1, vh: window.innerHeight,
        faqTop: Math.round(faq.top),
        toastOverlapFaq: overlap,
        toastRightGap: tr ? Math.round(window.innerWidth - tr.right) : -1,
        deskFiles: document.querySelectorAll("#deskFiles .ds-file").length,
        panelShown: getComputedStyle(document.getElementById("panel-cleaner")).display !== "none",
      };
    });
    note("desk" + tag + "_card", dCard);
    if (!dCard.cardVisible) throw new Error("kartu file tidak kelihatan di viewport @" + tag + " (top " + dCard.cardTop + ", bottom " + dCard.cardBottom + ", vh " + dCard.vh + ")");
    if (dCard.toastOverlapFaq) throw new Error("toast menutupi judul FAQ @" + tag);
    if (dCard.toastRightGap !== -1 && (dCard.toastRightGap < 16 || dCard.toastRightGap > 32)) throw new Error("toast bukan di pojok kanan @" + tag + " (gap " + dCard.toastRightGap + ")");
    if (dCard.deskFiles !== 1) throw new Error("daftar file sidebar harus 1, got " + dCard.deskFiles);
    if (!dCard.panelShown) throw new Error("panel workspace tidak tampil setelah upload @" + tag);
    await pd.screenshot({ path: "/home/hatch/workspace/sirna-desktop-audit/desktop-card-" + tag + ".png" });
    // (D3) pilih Bersihkan lewat sidebar -> editor kanonis di workspace:
    // canvas kelihatan, pil utama = pil melayang kanan bawah (bukan bar
    // selebar layar), inspector pengaturan tampil (kolom kanan), maskot
    // tidak lagi di tepi kiri viewport.
    await pd.click('[data-sidebar-tool="clean"]');
    await pd.waitForTimeout(700);
    await pd.click("#primaryBtn");
    await waitFor(pd, () => document.querySelectorAll('button[data-act="save"]:not(.hidden)').length >= 1, 30000);
    await pd.waitForTimeout(500);
    const dEd = await pd.evaluate(() => {
      const img = document.getElementById("shellImg").getBoundingClientRect();
      const bar = document.getElementById("primaryBar").getBoundingClientRect();
      const sc = document.getElementById("settingsCard").getBoundingClientRect();
      const pc = document.getElementById("panel-cleaner");
      return {
        canvasVisible: img.width > 0 && img.height > 100,
        primaryIsPill: Math.round(bar.width) < window.innerWidth - 100,
        primaryRightGap: Math.round(window.innerWidth - bar.right),
        primaryBottomGap: Math.round(window.innerHeight - bar.bottom),
        primaryLabel: document.getElementById("primaryBtn").textContent,
        inspectorVisible: getComputedStyle(pc).display === "grid" && sc.width > 0,
        inspectorW: Math.round(sc.width),
        mascotBox: (() => { const r = document.getElementById("mascotStage").getBoundingClientRect(); return { rightGap: Math.round(window.innerWidth - r.right), bottomGap: Math.round(window.innerHeight - r.bottom), w: Math.round(r.width) }; })(),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    note("desk" + tag + "_editor", dEd);
    if (!dEd.canvasVisible) throw new Error("canvas editor tidak kelihatan @" + tag);
    if (!dEd.primaryIsPill) throw new Error("tombol utama masih bar selebar layar @" + tag);
    if (dEd.primaryRightGap < 0 || dEd.primaryRightGap > 40) throw new Error("pil utama tidak di pojok kanan @" + tag + " (gap " + dEd.primaryRightGap + ")");
    if (!dEd.inspectorVisible) throw new Error("inspector pengaturan tidak tampil @" + tag);
    if (dEd.mascotBox.rightGap < 16 || dEd.mascotBox.rightGap > 32) throw new Error("maskot bukan di kolom kanan @" + tag + " (rightGap " + dEd.mascotBox.rightGap + ")");
    if (dEd.mascotBox.bottomGap < 120 || dEd.mascotBox.bottomGap > 165) throw new Error("maskot tidak di atas pil utama @" + tag + " (bottomGap " + dEd.mascotBox.bottomGap + ")");
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
