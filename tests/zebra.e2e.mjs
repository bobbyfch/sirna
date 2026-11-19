// E2E regresi zebra + export Hapus Objek (Step 0 redesign).
// Skenario A diagnosa: potret B&W 1200x1496 tanpa zebra (tests/fixtures/
// bw-portrait.png), mask pita mata ~6,2% -> Hapus Instan.
// 1) Tombol Hapus disabled sebelum ada coretan; strip langkah sorot aktif.
// 2) Peringatan mask besar muncul (>2% foto) + tombol "Pakai Cepat AI".
// 3) Hasil Instan TIDAK belang: runs/baris & ekstrem di pita mendekati
//    sumber (bukan 2,5x lipat seperti Telea lama).
// 4) "Urungkan hasil" mengembalikan gambar pra-run (piksel band = asli).
// 5) Unduh/Simpan MEMBAWA hasil hapus (bug export Nov 2026: dulu hasil
//    hilang karena buildExport dipanggil setelah mask dibersihkan).
// 6) Viewport 390px: tanpa overflow, 0 console error.
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const TEST_IMG = new URL("./fixtures/bw-portrait.png", import.meta.url).pathname;
const OUT = "/tmp/zebra-e2e-result.json";
const log = [];
function note(k, v) { log.push([k, v]); console.log("##", k, "=", typeof v === "string" ? v : JSON.stringify(v)); }

const IMG_DATA_URL = "data:image/png;base64," + readFileSync(TEST_IMG).toString("base64");
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
} catch (_e) { /* tanpa proxy */ }
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, ...(proxyOpt ? { proxy: proxyOpt } : {}) });
const page = await ctx.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

/* Metrik garis di pita (x150..900, y385..530): runs/baris + ekstrem + sd. */
async function bandStats() {
  return await page.evaluate(() => {
    const c = document.getElementById("eraseCanvas");
    const x = c.getContext("2d");
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;
    const x0 = 150, x1 = 900, y0 = 385, y1 = 530;
    let runs = 0, rows = 0, ext = 0, n = 0, sum = 0, sum2 = 0;
    for (let y = y0; y < y1; y++) {
      let s = 0, nn = 0;
      for (let xx = x0; xx < x1; xx++) { const i = (y * W + xx) * 4; s += (d[i] + d[i + 1] + d[i + 2]) / 3; nn++; }
      const th = s / nn;
      let prev = null, r = 0;
      for (let xx = x0; xx < x1; xx++) {
        const i = (y * W + xx) * 4;
        const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
        const b = v >= th ? 1 : 0;
        if (prev !== null && b !== prev) r++;
        prev = b;
        n++; if (v <= 2 || v >= 253) ext++; sum += v; sum2 += v * v;
      }
      runs += r; rows++;
    }
    const mean = sum / n;
    return { runsRow: +(runs / rows).toFixed(1), extPct: +(100 * ext / n).toFixed(1), sd: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1), n };
  });
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  // Pilih Bersihkan dulu (tanpa alat, file cuma diantre; arah 19 Nov 2026).
  await page.click('[data-tool="clean"]');
  await page.waitForTimeout(500);
  await page.setInputFiles("#fileInput", TEST_IMG);
  await page.waitForFunction(() => {
    const b = document.getElementById("primaryBtn");
    return b && !document.getElementById("primaryBar").classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, { timeout: 30000 });
  note("cleanDone", "primary Simpan foto visible");
  await page.click('[data-tool-switch="erase"]');
  await page.waitForSelector("#eraseModal:not(.hidden)", { timeout: 10000 });

  // (1) Hapus disabled sebelum coretan; strip langkah sudah dihapus (prinsip F).
  note("runDisabledBeforePaint", await page.evaluate(() => document.getElementById("eraseRun").disabled));
  note("stepsAbsent", await page.evaluate(() => !document.getElementById("eraseSteps")));
  note("warnHiddenBeforePaint", await page.evaluate(() => document.getElementById("eraseMaskWarn").classList.contains("hidden")));

  // Coret pita mata (5 garis, kuas 48) -> ~6% foto.
  // Box kanvas dibaca ulang per garis: begitu mask >2%, peringatan mask
  // besar muncul dan sheet modal recenters — box lama bikin coretan
  // mendarat ~32px meleset (celah tak ter-mask di tengah coretan).
  async function paintLine(x1, y1, x2, y2) {
    const box = await page.locator("#eraseCanvas").boundingBox();
    const toPx = (ix, iy) => ({ x: box.x + (ix / 1200) * box.width, y: box.y + (iy / 1496) * box.height });
    const a = toPx(x1, y1), b = toPx(x2, y2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
  for (const y of [400, 430, 460, 490, 520]) await paintLine(160, y, 890, y);
  await page.waitForTimeout(400);

  // (2) Hapus aktif + peringatan mask besar muncul.
  note("runEnabledAfterPaint", await page.evaluate(() => !document.getElementById("eraseRun").disabled));
  note("maskWarnVisible", await page.evaluate(() => !document.getElementById("eraseMaskWarn").classList.contains("hidden")));
  note("maskWarnText", await page.locator("#eraseMaskWarnText").textContent());
  note("runEnabledStillAfterPaint", await page.evaluate(() => !document.getElementById("eraseRun").disabled));
  note("overlayPixels", await page.evaluate(() => {
    const c = document.getElementById("eraseOverlay");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return { painted: n, frac: +(n / (c.width * c.height)).toFixed(4) };
  }));

  // (3) Hapus Instan -> ukur belang di pita (sumber: runs ~45, ekstrem ~1%).
  const srcStats = await bandStats();
  note("bandBefore", srcStats);
  await page.click("#eraseRun");
  await page.waitForSelector("#eraseResultBar:not(.hidden)", { timeout: 60000 });
  note("noteText", await page.locator("#eraseNote").textContent());
  note("undoResultVisible", await page.evaluate(() => !document.getElementById("eraseUndoResult").classList.contains("hidden")));
  const afterStats = await bandStats();
  note("bandAfterInstant", afterStats);
  note("zebraRegression", { runsRowOK: afterStats.runsRow < 60, extOK: afterStats.extPct < 10, note: "OLD telea: runs 99.5, ext 47.3% — NEW harus jauh di bawah" });

  // (4) Urungkan hasil -> band kembali = asli.
  await page.click("#eraseUndoResult");
  await page.waitForTimeout(400);
  const undoStats = await page.evaluate((imgDataUrl) => {
    const c = document.getElementById("eraseCanvas");
    const x = c.getContext("2d");
    const d = x.getImageData(0, 0, c.width, c.height);
    const orig = document.createElement("canvas");
    orig.width = c.width; orig.height = c.height;
    const octx = orig.getContext("2d");
    const img = new Image();
    return new Promise((resolve) => {
      img.onload = () => {
        octx.drawImage(img, 0, 0, c.width, c.height);
        const od = octx.getImageData(0, 0, c.width, c.height);
        let diff = 0, n = 0;
        for (let y = 385; y < 530; y++) for (let xx = 150; xx < 900; xx++) {
          const i = (y * c.width + xx) * 4;
          n++;
          if (d.data[i] !== od.data[i] || d.data[i + 1] !== od.data[i + 1] || d.data[i + 2] !== od.data[i + 2]) diff++;
        }
        resolve({ bandDiffAfterUndo: diff, bandN: n, resultBarHidden: document.getElementById("eraseResultBar").classList.contains("hidden") });
      };
      img.onerror = () => resolve({ error: "img load failed" });
      img.src = imgDataUrl;
    });
  }, IMG_DATA_URL);
  note("undoResult", undoStats);

  // (5) Hapus lagi -> Simpan hasil -> Unduh lewat tombol utama
  //     "Simpan foto" (satu jalur simpan, prinsip C) -> piksel band
  //     hasil unduhan HARUS berubah, luar band HARUS sama persis
  //     dengan file asli.
  await page.click("#eraseRun");
  await page.waitForSelector("#eraseResultBar:not(.hidden)", { timeout: 60000 });
  await page.click("#eraseSave");
  await page.waitForTimeout(500);
  const dl = page.waitForEvent("download", { timeout: 30000 });
  await page.click("#primaryBtn");
  const download = await dl;
  const dlPath = "/tmp/zebra-downloaded.png";
  await download.saveAs(dlPath);
  const dlB64 = readFileSync(dlPath).toString("base64");
  note("downloadFile", download.suggestedFilename() + " " + dlB64.length + " chars b64");
  const exportCheck = await page.evaluate(async (args) => {
    const [origUrl, dlUrl] = args;
    const load = (u) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u; });
    const o = await load(origUrl), e = await load(dlUrl);
    const W = o.width, H = o.height;
    const oc = document.createElement("canvas"); oc.width = W; oc.height = H;
    const ec = document.createElement("canvas"); ec.width = W; ec.height = H;
    oc.getContext("2d").drawImage(o, 0, 0);
    ec.getContext("2d").drawImage(e, 0, 0);
    const od = oc.getContext("2d").getImageData(0, 0, W, H).data;
    const ed = ec.getContext("2d").getImageData(0, 0, W, H).data;
    let bandDiff = 0, bandN = 0, outDiff = 0, outN = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const same = od[i] === ed[i] && od[i + 1] === ed[i + 1] && od[i + 2] === ed[i + 2];
      const inBand = x >= 150 && x <= 900 && y >= 385 && y <= 530;
      // "Luar" = di luar pita + margin 90px. Margin 60px lama SALAH:
      // kuas 48px itu 48px DISPLAY — kanvas kerja (1024px) ditampilkan
      // ~468px, jadi 48px display ≈ 105px kerja ≈ 76px full-res; +
      // dilasi mask + tepi lembut upscale, jejak kuas mencapai ~83px
      // di luar garis coretan (terukur: diff sampai y=603, garis
      // terbawah y=520). Di luar jejak kuas ASLI, piksel harus identik.
      const nearBand = x >= 60 && x <= 990 && y >= 295 && y <= 620;
      if (inBand) { bandN++; if (!same) bandDiff++; }
      else if (!nearBand) { outN++; if (!same) outDiff++; }
    }
    return { w: W, h: H, bandChangedPct: +(100 * bandDiff / bandN).toFixed(1), outsideDiff: outDiff, outsideN: outN };
  }, [IMG_DATA_URL, "data:image/png;base64," + dlB64]);
  note("exportCheck", exportCheck);
  note("exportRegression", { bandChangedOK: exportCheck.bandChangedPct > 50, outsideOK: exportCheck.outsideDiff === 0 });
  // Modal sudah tertutup oleh #eraseSave (Simpan hasil = kembali + simpan).
  note("modalClosedAfterSave", await page.evaluate(() => document.getElementById("eraseModal").classList.contains("hidden")));
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));

// Viewport 390px: overflow horizontal + console error.
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
const p2 = await ctx2.newPage();
const errs2 = [];
p2.on("console", (m) => { if (m.type() === "error") errs2.push(m.text()); });
p2.on("pageerror", (e) => errs2.push(String(e)));
await p2.goto(BASE, { waitUntil: "networkidle" });
await p2.waitForTimeout(1000);
const overflow = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
note("overflow390", overflow);
await p2.click('[data-tool="clean"]'); // tanpa alat, file cuma diantre (arah 19 Nov 2026)
await p2.waitForTimeout(500);
await p2.setInputFiles("#fileInput", TEST_IMG);
await p2.waitForFunction(() => {
  const b = document.getElementById("primaryBtn");
  return b && !document.getElementById("primaryBar").classList.contains("hidden") && b.textContent.includes("Simpan foto");
}, { timeout: 30000 });
await p2.click('[data-tool-switch="erase"]');
await p2.waitForSelector("#eraseModal:not(.hidden)", { timeout: 10000 });
await p2.waitForTimeout(800);
const overflow2 = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, modalSw: document.getElementById("eraseModal").scrollWidth }));
note("overflow390Editor", overflow2);
note("consoleErrors390", errs2.slice(0, 10));

await browser.close();
server.kill();
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
