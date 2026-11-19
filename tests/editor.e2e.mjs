// Langkah 4 — kejelasan editor (copy B1–B17) pasca redesain:
// B5 deskripsi statis TANPA nama model/ukuran (P2-03), strip langkah
// DIHAPUS (prinsip F — diganti baris status), subhead sumber B1, catatan
// deteksi B2–B3, "Urungkan hasil", "Lihat asli" toggle (prinsip I),
// kuas, dan "Mulai dari file asli". Ganti alat lewat rail kepala editor
// LANGSUNG membuka editor (prinsip B) — tanpa klik tombol utama dulu.
// Unduhan model KEMBALI 19 Nov 2026 (arah single-engine Bobby 08:17 WIB,
// menggantikan revert no-model 02:30 WIB): buka editor TIDAK mengunduh
// apa pun (lazy), tapi sekali Hapus ditekan, Mi-GAN (URL ter-pin) +
// ORT wasm diunduh — diasersi di sini sebagai URL ter-pin, bukan NOL.
// B17-via-model (gagal hapus karena model gagal) diasersi di
// tests/dist.test.mjs — Telea tidak bisa dibuat gagal dari input valid
// tanpa sabotase buatan.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const F = (p) => new URL("./fixtures/" + p, import.meta.url).pathname;
const OUT = "/tmp/editor-e2e-result.json";
const log = [];
function note(k, v) { log.push([k, v]); console.log("##", k, "=", typeof v === "string" ? v : JSON.stringify(v)); }

const NO_MODEL_RE = /huggingface|staticimgly|onnxruntime|ort-wasm|migan|lama|\.onnx|isnet/i;

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
async function paintCircle(page) {
  // Baca box kanvas SEBELUM TIAP coretan: begitu mask melewati 2%,
  // peringatan mask besar muncul dan sheet modal recenters — kanvas
  // bergeser ~24px. Koordinat dari box lama mendarat ~32px meleset dan
  // menyisakan celah tak ter-mask di tengah coretan (piksel merah itu
  // lalu jadi "benih" buat Telea, pusat lingkaran tetap merah).
  // Pengguna nyata tidak kena ini (evtPos baca rect live per event);
  // tes meniru jari yang mengikuti kanvas.
  for (const y of [250, 270, 290, 310, 330, 350]) {
    const box = await page.locator("#eraseCanvas").boundingBox();
    const toPx = (ix, iy) => ({ x: box.x + (ix / 800) * box.width, y: box.y + (iy / 600) * box.height });
    const a = toPx(335, y), b = toPx(465, y);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y, { steps: 2 });
    await page.mouse.up(); await page.waitForTimeout(80);
  }
}

// waitFor: polling via evaluate tiap 100 ms. JANGAN pakai
// page.waitForFunction di tes multi-konteks: polling default-nya 'raf'
// dan rAF bisa berhenti jalan di konteks ke-2 setelah konteks ke-1
// ditutup (predikat sudah true via evaluate, tapi waitForFunction tetap
// timeout 30 dtk) — quirk harness, bukan bug aplikasi.
async function waitFor(pg, fn, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    if (await pg.evaluate(fn)) return;
    if (Date.now() - t0 > timeout) throw new Error("waitFor timeout: " + fn.toString().slice(0, 120));
    await pg.waitForTimeout(100);
  }
}
const consoleErrors = [];
const pageErrors = [];
try {
  // ── Konteks 1: jalur sukses (SATU engine Mi-GAN) ──
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
  const page = await ctx.newPage();
  const reqs = [];
  page.on("request", (r) => reqs.push(r.url()));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const modelReqs = () => reqs.filter((u) => NO_MODEL_RE.test(u));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  note("initialModelReqs", modelReqs().length === 0 ? "NONE (good)" : modelReqs());
  await page.click('[data-tool="clean"]');
  await page.waitForTimeout(500);
  await page.setInputFiles("#fileInput", [F("wm-test.png")]);
  await waitFor(page, () => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, 30000);
  await page.waitForTimeout(400);

  // B1 + B5: editor dari hasil Bersihkan — chip rail kepala editor
  // LANGSUNG membuka editor (prinsip B), tanpa klik tombol utama dulu.
  await page.click('[data-tool-switch="erase"]');
  await waitFor(page, () => !document.getElementById("eraseModal").classList.contains("hidden"), 10000);
  note("B1_subheadClean", await page.locator("#eraseSub").textContent());
  note("B5_desc", await page.locator("#eraseModal .erase-mode-desc").textContent());
  note("B5_noModeButtons", await page.evaluate(() => document.querySelectorAll("[data-erase-mode]").length));
  // Bar progres model ADA (bukan tidak ada): unduhan sekali + Batalkan.
  note("B5_modelBarExists", await page.evaluate(() => document.getElementById("eraseModelBar") !== null));
  note("B5_modelBarHiddenBeforeRun", await page.evaluate(() => document.getElementById("eraseModelProgress").classList.contains("hidden")));
  note("modelReqsAfterOpen", modelReqs().length); // buka editor tidak mengunduh apa pun
  // Strip langkah DIHAPUS (prinsip F): tidak ada lagi #eraseSteps.
  note("stepsAbsent", await page.evaluate(() => !document.getElementById("eraseSteps")));
  note("toolStatusText", await page.evaluate(() => document.getElementById("toolStatus")?.textContent?.trim() || ""));
  // Hapus mulai disabled sampai ada coretan.
  note("runDisabledBeforePaint", await page.evaluate(() => document.getElementById("eraseRun").disabled));
  // Kuas: ganti ukuran -> label ikut.
  await page.evaluate(() => { const el = document.getElementById("eraseBrush"); el.value = "80"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  note("brushVal", await page.locator("#eraseBrushVal").textContent());

  // Coret lingkaran merah -> Hapus jadi enabled.
  await paintCircle(page);
  await page.waitForTimeout(400);
  note("runEnabledAfterPaint", await page.evaluate(() => !document.getElementById("eraseRun").disabled));

  // Hapus -> catatan hasil, bar hasil muncul.
  await page.click("#eraseRun");
  await waitFor(page, () => !document.getElementById("eraseResultBar").classList.contains("hidden"), 60000);
  note("runNote", await page.locator("#eraseNote").textContent());
  const centerAfter = await page.evaluate(() => {
    const c = document.getElementById("eraseCanvas");
    const d = c.getContext("2d").getImageData(400, 300, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  note("centerAfterRun", centerAfter); // dulu merah (220,30,30) -> terisi gradien

  // "Lihat asli" = toggle ketuk-sekali (prinsip I): ketuk -> tengah
  // kembali merah; ketuk lagi -> hasil lagi.
  await page.click("#eraseCompare");
  await page.waitForTimeout(300);
  note("centerWhileComparing", await page.evaluate(() => {
    const c = document.getElementById("eraseCanvas");
    const d = c.getContext("2d").getImageData(400, 300, 1, 1).data;
    return [d[0], d[1], d[2]];
  }));
  await page.click("#eraseCompare");
  await page.waitForTimeout(300);
  note("centerAfterCompareOff", await page.evaluate(() => {
    const c = document.getElementById("eraseCanvas");
    const d = c.getContext("2d").getImageData(400, 300, 1, 1).data;
    return [d[0], d[1], d[2]];
  }));

  // "Urungkan hasil": bar hasil hilang, tengah kembali merah, toast benar.
  await page.click("#eraseUndoResult");
  await page.waitForTimeout(400);
  note("resultBarHiddenAfterUndo", await page.evaluate(() => document.getElementById("eraseResultBar").classList.contains("hidden")));
  note("centerAfterUndo", await page.evaluate(() => {
    const c = document.getElementById("eraseCanvas");
    const d = c.getContext("2d").getImageData(400, 300, 1, 1).data;
    return [d[0], d[1], d[2]];
  }));
  note("undoToast", await page.locator("#toast").textContent());
  await page.click("#eraseClose");
  await page.waitForTimeout(400);

  // B2: Watermark editor — deteksi ketemu 2 tanda.
  await page.click('[data-tool-switch="watermark"]');
  await waitFor(page, () => !document.getElementById("eraseModal").classList.contains("hidden"), 10000);
  await page.waitForTimeout(800);
  note("B2_note", await page.locator("#eraseNote").textContent());
  note("B1_subheadWatermark", await page.locator("#eraseSub").textContent());
  await page.click("#eraseClose");
  await page.waitForTimeout(400);
  // Sekali Hapus ditekan, Mi-GAN ter-pin + ORT wasm diunduh (lazy, sekali).
  // URL model HARUS yang ter-pin — bukan main, bukan host lain.
  note("modelReqsCtx1", modelReqs());
  note("modelReqsCtx1PinnedOnly", modelReqs().every((u) => u.includes("406830d0fa60666da0071c342ad2fbc8f30c5c64") || u.includes("127.0.0.1:4173/ort/")));
  await ctx.close();

  // ── Konteks 2: B1 "Mulai dari file asli" ──
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
  const page2 = await ctx2.newPage();
  const reqs2 = [];
  page2.on("request", (r) => reqs2.push(r.url()));
  page2.on("console", (m) => { if (m.type() === "error") consoleErrors.push("ctx2: " + m.text()); });
  page2.on("pageerror", (e) => pageErrors.push("ctx2: " + String(e)));
  await page2.goto(BASE, { waitUntil: "networkidle" });
  await page2.waitForTimeout(1000);
  await page2.click('[data-tool="clean"]');
  await page2.waitForTimeout(500);
  await page2.setInputFiles("#fileInput", [F("wm-test.png")]);
  await waitFor(page2, () => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, 30000);
  await page2.waitForTimeout(400);
  await page2.click('[data-tool-switch="erase"]');
  await waitFor(page2, () => !document.getElementById("eraseModal").classList.contains("hidden"), 10000);
  note("B1_beforeUseOriginal", await page2.locator("#eraseSub").textContent());
  // Tombol "Mulai dari file asli" tampil karena sumbernya hasil Bersihkan.
  note("useOriginalVisible", await page2.evaluate(() => !document.getElementById("eraseUseOriginal").classList.contains("hidden")));
  await page2.click("#eraseUseOriginal");
  await waitFor(page2, () => !document.getElementById("eraseModal").classList.contains("hidden"), 10000);
  await page2.waitForTimeout(400);
  note("B1_afterUseOriginal", await page2.locator("#eraseSub").textContent());
  note("modelReqsCtx2", reqs2.filter((u) => NO_MODEL_RE.test(u)).length);
  await ctx2.close();

  // ── Konteks 3: B1 "Asli" + B3 (foto tanpa watermark) ──
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
  const page3 = await ctx3.newPage();
  page3.on("console", (m) => { if (m.type() === "error") consoleErrors.push("ctx3: " + m.text()); });
  page3.on("pageerror", (e) => pageErrors.push("ctx3: " + String(e)));
  await page3.goto(BASE, { waitUntil: "networkidle" });
  await page3.waitForTimeout(1000);
  // B1 Asli: workspace Hapus Objek (tanpa Bersihkan) -> upload LANGSUNG
  // buka editor dari file asli (prinsip B).
  await page3.click('[data-tool="erase"]');
  await page3.waitForTimeout(500);
  await page3.setInputFiles("#fileInput", [F("wm-clean.png")]);
  await waitFor(page3, () => !document.getElementById("eraseModal").classList.contains("hidden"), 10000);
  note("B1_subheadAsli", await page3.locator("#eraseSub").textContent());
  await page3.click("#eraseClose");
  await page3.waitForTimeout(400);
  // B3: Watermark editor di foto tanpa watermark.
  await page3.click('[data-tool-switch="watermark"]');
  await waitFor(page3, () => !document.getElementById("eraseModal").classList.contains("hidden"), 10000);
  await page3.waitForTimeout(800);
  note("B3_note", await page3.locator("#eraseNote").textContent());
  note("B3_overlay", await page3.evaluate(() => {
    const o = document.getElementById("eraseOverlay");
    const d = o.getContext("2d").getImageData(0, 0, o.width, o.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  }));
  await ctx3.close();
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
await browser.close();
server.kill();
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
