// Alur file-first (WORKFLOW-REDESIGN.md §(f).2): home = dropzone besar +
// contoh di bawahnya (tanpa pemilih alat) -> upload dari home -> editor
// terbuka, Bersihkan jalan sendiri -> ganti chip di rail -> Back ->
// #queueHint + "Buka editor" -> header "+ File" 3 cabang -> video /
// corrupt / batch / contoh -> overlap mascot + top bar (390px) -> Simpan.
// + 390px & 1440px, 0 console/page error.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const F = (p) => new URL("./fixtures/" + p, import.meta.url).pathname;
const OUT = "/tmp/filefirst-e2e-result.json";
const SHOTS = "/home/hatch/workspace/sirna-pivot-design/after/";
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
function newCtx(viewport) {
  return browser.newContext({ viewport, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
}
async function waitSave(pg, label = "Simpan foto", timeout = 60000) {
  await pg.waitForFunction((l) => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes(l);
  }, label, { timeout });
}
async function restart(pg) {
  await pg.click("#restartBtn");
  await pg.waitForTimeout(400);
  await pg.click("#sheetConfirm");
  await pg.waitForTimeout(600);
}
function rectsOverlap(a, b) {
  return a && b && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

try {
  // ── Langkah 1: home 390 + 1440 + 1280 ──
  for (const [w, h, tag] of [[390, 844, "390"], [1440, 900, "1440"], [1280, 900, "1280"]]) {
    const c = await newCtx({ width: w, height: h });
    const p = await c.newPage();
    p.on("console", (m) => { if (m.type() === "error") consoleErrors.push(tag + ": " + m.text()); });
    p.on("pageerror", (e) => pageErrors.push(tag + ": " + String(e)));
    await p.goto(BASE, { waitUntil: "networkidle" });
    await p.waitForTimeout(1000);
    const home = await p.evaluate(() => {
      const dz = document.getElementById("dropZone").getBoundingClientRect();
      const sr = document.getElementById("sampleRow").getBoundingClientRect();
      return {
        dropzoneInViewport: dz.top >= 0 && dz.bottom <= window.innerHeight,
        toolPickerAbsent: !document.getElementById("toolPicker"),
        sampleBelowDropzone: sr.top >= dz.bottom - 1,
        historyVisible: !document.getElementById("historySection").classList.contains("hidden"),
        subNoPilihAlat: !(document.querySelector("#heroSection p")?.textContent || "").includes("Pilih alat"),
      };
    });
    note("home_" + tag, home);
    if (!home.dropzoneInViewport) throw new Error("dropzone tidak penuh di viewport @" + tag);
    if (!home.toolPickerAbsent) throw new Error("toolPicker masih ada @" + tag);
    if (!home.sampleBelowDropzone) throw new Error("contoh tidak di bawah dropzone @" + tag);
    if (!home.subNoPilihAlat) throw new Error("sub hero masih berisi 'Pilih alat' @" + tag);
    await c.close();
  }

  // ── Konteks utama 1280: langkah 2–9, 11 ──
  const ctx = await newCtx({ width: 1280, height: 900 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // (2) Upload dari home -> auto-clean.
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await waitSave(page);
  await page.waitForTimeout(400);
  note("autoClean_editorOpened", await page.evaluate(() => document.getElementById("heroSection").classList.contains("hidden") && document.body.classList.contains("editor-on")));
  note("autoClean_chipActive", await page.evaluate(() => document.querySelector('[data-tool-switch="clean"]').classList.contains("active")));
  note("autoClean_pill", await page.locator("#shellPill").textContent());
  note("autoClean_toolStatus", await page.evaluate(() => document.getElementById("toolStatus")?.textContent?.trim()));
  if ((await page.locator("#shellPill").textContent()).trim() !== "Sudah bersih") throw new Error("pill bukan 'Sudah bersih' setelah auto-clean");
  if (!(await page.evaluate(() => document.getElementById("toolStatus")?.textContent || "")).includes("Sudah beres")) throw new Error("toolStatus bukan 'Sudah beres' setelah auto-clean");

  // (3) Ganti chip alat -> Simpan tetap.
  await page.click('[data-tool-switch="meta"]');
  await page.waitForFunction(() => !document.getElementById("metaPanel").classList.contains("hidden") && !!document.querySelector("#metaPanel .meta-row"), { timeout: 15000 });
  note("chipMeta_panelVisible", await page.evaluate(() => !document.getElementById("metaPanel").classList.contains("hidden")));
  note("chipMeta_filmKept", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb").length));
  await page.click('[data-tool-switch="watermark"]');
  await page.waitForFunction(() => {
    const t = document.getElementById("shellResult")?.textContent || "";
    return t.includes("Tidak ketemu tanda watermark") || t.includes("bukan pola Gemini") || t.includes("Sparkle Gemini dihapus");
  }, { timeout: 15000 });
  note("chipWatermark_result", await page.locator("#shellResult").textContent());
  await page.click('[data-tool-switch="clean"]');
  await page.waitForFunction(() => (document.getElementById("shellPill")?.textContent || "").includes("Sudah bersih"), { timeout: 15000 });
  note("chipClean_pillBack", await page.locator("#shellPill").textContent());
  note("chipClean_primary", await page.locator("#primaryBtn").textContent());
  if ((await page.locator("#primaryBtn").textContent()).trim() !== "Simpan foto") throw new Error("primary bukan 'Simpan foto' setelah ganti chip");

  // (4) Back -> home -> Buka editor.
  await page.click("#editorBackBtn");
  await page.waitForTimeout(600);
  note("back_queueHintVisible", await page.evaluate(() => !document.getElementById("queueHint").classList.contains("hidden")));
  note("back_queueHintText", await page.evaluate(() => document.getElementById("queueHintText")?.textContent?.trim()));
  if (!(await page.evaluate(() => document.getElementById("queueHintText")?.textContent || "")).includes("1 file di antrean")) throw new Error("queueHint bukan '1 file di antrean'");
  await page.click("#resumeBtn");
  await page.waitForTimeout(600);
  note("resume_film", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb").length));
  note("resume_pill", await page.locator("#shellPill").textContent());
  if ((await page.locator("#shellPill").textContent()).trim() !== "Sudah bersih") throw new Error("pill tidak 'Sudah bersih' setelah resume (dibersihkan ulang?)");

  // (5) Header "+ File" — 3 cabang.
  // (5a) Home kosong -> scroll ke dropzone.
  await restart(page);
  await page.click("#topAddBtn");
  await page.waitForTimeout(800);
  note("topAdd_emptyHome", await page.evaluate(() => { const r = document.getElementById("dropZone").getBoundingClientRect(); return { inViewport: r.top >= 0 && r.bottom <= window.innerHeight, top: Math.round(r.top) }; }));
  if (!await page.evaluate(() => { const r = document.getElementById("dropZone").getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })) throw new Error("+ File di home kosong tidak scroll ke dropzone");
  // (5b) Home berantrean -> buka editor.
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await waitSave(page);
  await page.click("#editorBackBtn");
  await page.waitForTimeout(600);
  await page.click("#topAddBtn");
  await page.waitForTimeout(600);
  note("topAdd_queuedHome", await page.evaluate(() => document.getElementById("heroSection").classList.contains("hidden") && !document.getElementById("panel-cleaner").classList.contains("hidden")));
  if (!await page.evaluate(() => document.getElementById("heroSection").classList.contains("hidden"))) throw new Error("+ File di home berantrean tidak membuka editor");
  // (5c) Editor -> buka file picker.
  // PENYIMPANGAN dari WORKFLOW-REDESIGN.md §B.8 (dilaporkan ke parent):
  // header situs disembunyikan saat editor aktif (body.editor-on
  // header{display:none} — perilaku pivot yang dipertahankan & diasersi
  // layout.e2e "siteHeaderHiddenInEditor"), jadi tombol "+ File" TIDAK
  // punya pemicu UI yang terlihat di editor; cabang ini diverifikasi
  // lewat klik programatik pada handler yang sama. Tambah file di editor
  // tetap bisa lewat drop di mana saja / paste (routeFiles).
  const fcPromise = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.evaluate(() => document.getElementById("topAddBtn").click());
  const fc = await fcPromise;
  note("topAdd_editorFilechooser", !!fc);
  await fc.setFiles([F("matrix/png-text.png")]);
  await page.waitForFunction(() => document.querySelectorAll("#shellFilm .shell-thumb").length === 2, { timeout: 15000 });
  note("topAdd_editorAddedFile", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb").length));

  // (6) Video: auto-clean jalan; chip meta/watermark foto-only.
  await restart(page);
  await page.setInputFiles("#fileInput", [F("smoke/mp4-label-mdat.mp4")]);
  await page.waitForFunction(() => {
    const p = document.getElementById("shellPill");
    return p && p.textContent.trim() !== "Lagi dibersihin…";
  }, { timeout: 30000 });
  await page.waitForTimeout(400);
  note("video_pill", await page.locator("#shellPill").textContent());
  const videoResult = (await page.locator("#shellResult").textContent()) || "";
  note("video_result", videoResult);
  // Kotak hasil video (A8) harus tampil: pernah hilang karena selectItem
  // menghapus render sinkron failClean — regresi urutan file-first.
  if (!videoResult.includes("Label ketemu")) fail("video_result_empty", "Kotak hasil video A8 kosong — seharusnya 'Label ketemu, tapi tidak bisa dibuang dari file ini.'");
  note("video_chipsDisabled", await page.evaluate(() => ({
    meta: document.querySelector('[data-tool-switch="meta"]').disabled,
    watermark: document.querySelector('[data-tool-switch="watermark"]').disabled,
  })));
  // Penolakan photo-only sebagai teks status: foto -> chip meta -> pilih video.
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await waitSave(page);
  await page.click('[data-tool-switch="meta"]');
  await page.waitForFunction(() => !document.getElementById("metaPanel").classList.contains("hidden"), { timeout: 15000 });
  const vidId = await page.evaluate(() => document.querySelectorAll("#shellFilm button")[0]?.dataset.shellId);
  await page.click(`#shellFilm button[data-shell-id="${vidId}"]`);
  await page.waitForTimeout(500);
  note("video_photoOnlyStatus", await page.evaluate(() => document.getElementById("toolStatus")?.textContent?.trim()));
  note("video_photoOnlyPrimary", await page.evaluate(() => document.getElementById("primaryBtn").classList.contains("hidden") ? "(hidden)" : document.getElementById("primaryBtn").textContent.trim()));
  if (!(await page.evaluate(() => document.getElementById("toolStatus")?.textContent || "")).includes("hanya untuk foto")) throw new Error("status photo-only tidak muncul untuk video + meta");

  // (7) File corrupt: gagal jujur, Simpan disabled, file di antrean.
  await restart(page);
  await page.setInputFiles("#fileInput", [F("smoke/corrupt.png")]);
  await page.waitForFunction(() => {
    const p = document.getElementById("shellPill");
    return p && p.textContent.trim() === "Gagal";
  }, { timeout: 30000 });
  await page.waitForTimeout(400);
  note("corrupt_pill", await page.locator("#shellPill").textContent());
  note("corrupt_result", await page.locator("#shellResult").textContent());
  note("corrupt_hasRetry", await page.evaluate(() => !!document.querySelector('#shellResult button[data-act="reclean"]')));
  note("corrupt_primaryHidden", await page.evaluate(() => document.getElementById("primaryBtn").classList.contains("hidden")));
  note("corrupt_film", await page.evaluate(() => document.querySelectorAll("#shellFilm .shell-thumb").length));
  if (!await page.evaluate(() => document.getElementById("primaryBtn").classList.contains("hidden"))) throw new Error("Simpan tampil untuk file corrupt");

  // (8) Batch: dock "Membersihkan …" -> "Simpan semua (N)".
  await restart(page);
  await page.setInputFiles("#fileInput", [F("smoke/png-big.png"), F("matrix/png-text.png"), F("matrix/jpg-kitchen.jpg"), F("matrix/png-kitchen.png"), F("matrix/jpg-app1-exif.jpg"), F("matrix/png-c2pa.png")]);
  let dockSeen = false;
  for (let i = 0; i < 200; i++) {
    const t = await page.evaluate(() => {
      const d = document.getElementById("procDock");
      return d && !d.classList.contains("hidden") ? document.getElementById("procDockText")?.textContent || "" : "";
    });
    if (t.includes("Membersihkan")) { dockSeen = true; break; }
    await page.waitForTimeout(25);
  }
  note("batch_dockSeen", dockSeen);
  await waitSave(page, "Simpan semua (6)", 120000);
  note("batch_primary", await page.locator("#primaryBtn").textContent());
  if (!dockSeen) throw new Error("dock 'Membersihkan …' tidak tertangkap selama batch");

  // (9) Foto contoh dari home.
  await restart(page);
  await page.click("#sampleBtn");
  await waitSave(page);
  note("sample_pill", await page.locator("#shellPill").textContent());
  if ((await page.locator("#shellPill").textContent()).trim() !== "Sudah bersih") throw new Error("foto contoh tidak auto-clean");

  // (11) Simpan (happy path akhir) + tap proof.
  await restart(page);
  await page.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await waitSave(page);
  const tap = await page.evaluate(() => {
    const b = document.getElementById("primaryBtn");
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const el = document.elementFromPoint(cx, cy);
    return { inViewport: r.top >= 0 && r.bottom <= window.innerHeight, centerHit: el === b || b.contains(el), hitTag: el ? (el.id || el.className || el.tagName) : null, h: Math.round(r.height) };
  });
  note("save_tapProof", tap);
  if (!tap.centerHit) throw new Error("tombol Simpan tertutup " + tap.hitTag);
  if (tap.h < 44) throw new Error("tombol Simpan < 44px: " + tap.h);
  const dlPromise = page.waitForEvent("download", { timeout: 30000 });
  await page.click("#primaryBtn");
  const dl = await dlPromise;
  note("save_downloadName", dl.suggestedFilename());
  if (!dl.suggestedFilename().includes("-clean")) throw new Error("nama download tidak mengandung '-clean': " + dl.suggestedFilename());
  await ctx.close();

  // ── Langkah 10: overlap mascot + top bar (390px) ──
  const ctx10 = await newCtx({ width: 390, height: 844 });
  const p10 = await ctx10.newPage();
  p10.on("console", (m) => { if (m.type() === "error") consoleErrors.push("390: " + m.text()); });
  p10.on("pageerror", (e) => pageErrors.push("390: " + String(e)));
  await p10.goto(BASE, { waitUntil: "networkidle" });
  await p10.waitForTimeout(1000);
  // Deep ON dulu (warm-up) supaya batch cukup lama untuk diobservasi.
  await p10.setInputFiles("#fileInput", [F("matrix/png-text.png")]);
  await waitSave(p10);
  await p10.click('[data-mode="deep"]');
  await p10.waitForTimeout(300);
  await restart(p10);
  await p10.setInputFiles("#fileInput", [F("smoke/png-big.png"), F("matrix/png-text.png"), F("matrix/png-text.png"), F("matrix/png-text.png")]);
  // Tunggu dock tampil, lalu scroll MENTOK bawah dan ukur kontrol vs dock.
  await p10.waitForFunction(() => !document.getElementById("procDock").classList.contains("hidden"), { timeout: 15000 });
  await p10.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p10.waitForTimeout(300);
  const bottomCheck = await p10.evaluate(() => {
    const dock = document.getElementById("procDock").getBoundingClientRect();
    const grab = (id) => { const el = document.getElementById(id); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
    const dockR = { top: Math.round(dock.top), bottom: Math.round(dock.bottom), left: Math.round(dock.left), right: Math.round(dock.right) };
    const controls = { removeFileBtn: grab("removeFileBtn"), restartBtn: grab("restartBtn"), settingsHead: (() => { const el = document.querySelector("#settingsCard .set-head"); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; })() };
    const overlap = (a, b) => a && b && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    return { dock: dockR, controls, dockVisible: !document.getElementById("procDock").classList.contains("hidden"),
      overlapRemove: overlap(controls.removeFileBtn, dockR), overlapRestart: overlap(controls.restartBtn, dockR), overlapSettings: overlap(controls.settingsHead, dockR) };
  });
  note("overlap_bottomControls", bottomCheck);
  if (bottomCheck.overlapRemove || bottomCheck.overlapRestart || bottomCheck.overlapSettings) throw new Error("dock menutupi kontrol bawah editor: " + JSON.stringify(bottomCheck));
  // Bubble mascot vs kotak hasil: tangkap alami selama proses, bila tidak
  // tertangkap paksa .show saat stage tampil (posisi murni CSS).
  let bubbleNatural = false;
  for (let i = 0; i < 80; i++) {
    bubbleNatural = await p10.evaluate(() => document.getElementById("mascotBubble").classList.contains("show"));
    if (bubbleNatural) break;
    await p10.waitForTimeout(50);
  }
  if (!bubbleNatural) {
    await p10.evaluate(() => { document.getElementById("mascotStage").classList.add("show"); document.getElementById("mascotBubble").classList.add("show"); });
  }
  note("overlap_bubbleNatural", bubbleNatural);
  const bubbleCheck = await p10.evaluate(() => {
    const b = document.getElementById("mascotBubble").getBoundingClientRect();
    const r = document.getElementById("shellResult").getBoundingClientRect();
    const bb = { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) };
    const rb = { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
    const overlap = !(bb.right <= rb.left || bb.left >= rb.right || bb.bottom <= rb.top || bb.top >= rb.bottom);
    return { bubble: bb, result: rb, resultVisible: !document.getElementById("shellResult").classList.contains("hidden"), overlap };
  });
  note("overlap_bubbleVsResult", bubbleCheck);
  if (bubbleCheck.overlap) throw new Error("bubble mascot menutupi #shellResult: " + JSON.stringify(bubbleCheck));
  await p10.screenshot({ path: SHOTS + "filefirst-mascot-390.png" });
  // Top bar: scroll konten tebal ke bawah bar, screenshot (dicek visual).
  await waitSave(p10, "Simpan semua (4)", 120000);
  await p10.evaluate(() => document.getElementById("editorHead").scrollIntoView({ block: "start" }));
  await p10.waitForTimeout(400);
  await p10.evaluate(() => window.scrollBy(0, 300));
  await p10.waitForTimeout(400);
  await p10.screenshot({ path: SHOTS + "filefirst-topbar-390.png" });
  try {
    await p10.emulateMedia({ features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
    await p10.waitForTimeout(400);
    await p10.screenshot({ path: SHOTS + "filefirst-topbar-390-reduced-transparency.png" });
    note("topbar_reducedTransparencyShot", true);
  } catch (e) {
    note("topbar_reducedTransparencyShot", "unsupported: " + String(e).slice(0, 120));
  }
  await ctx10.close();
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
await browser.close();
server.kill();
if (log.some(([k]) => k === "ERROR")) process.exitCode = 1;
if (pageErrors.length) process.exitCode = 1;
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
