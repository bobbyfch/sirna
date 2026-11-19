// Edit Metadata (file-first): jejak-exif.jpg (Canon EOS R50 + GPS) ->
// upload dari home -> auto-clean dulu -> chip meta: panel membaca blob
// versi terpilih ("Bersih", EXIF sudah ter-strip) -> chip versi "Asli"
// + chip meta lagi: panel membaca file asli (Make Canon + GPS) ->
// edit Make in-place -> hapus GPS -> Terapkan -> status + nilai
// terverifikasi; "Hapus jejak" -> versi Metadata; guard draft kotor
// saat pindah alat (sheet "Buang perubahan").
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const F = (p) => new URL("./fixtures/" + p, import.meta.url).pathname;
const OUT = "/tmp/meta-e2e-result.json";
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

async function metaStatus() {
  return await page.evaluate(() => document.getElementById("metaStatus")?.textContent?.trim() || "");
}
async function fieldValue(id) {
  return await page.evaluate((fid) => {
    const el = document.querySelector(`input[data-field="${fid}"]`);
    return el ? el.value : null;
  }, id);
}
async function fieldRowExists(id) {
  return await page.evaluate((fid) => !!document.querySelector(`[data-field="${fid}"], [data-del="${fid}"]`), id);
}

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  // (0) File-first: upload dari home -> auto-clean -> chip meta.
  // Panel membaca blob versi terpilih ("Bersih"): EXIF sudah ter-strip,
  // jadi TIDAK ADA lagi field Make / GPS di panel ini.
  await page.setInputFiles("#fileInput", [F("jejak-exif.jpg")]);
  await page.waitForFunction(() => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, { timeout: 60000 });
  await page.click('[data-tool-switch="meta"]');
  await page.waitForFunction(() => !document.getElementById("metaPanel").classList.contains("hidden") && !!document.querySelector("#metaPanel .meta-row"), { timeout: 15000 });
  await page.waitForTimeout(400);
  note("panelVisible", await page.evaluate(() => !document.getElementById("metaPanel").classList.contains("hidden")));
  note("makeValueOnCleaned", await fieldValue("exif:0x10f"));
  note("gpsRowOnCleaned", await fieldRowExists("gps"));
  // Kembali ke versi "Asli" + buka meta lagi -> panel membaca file asli.
  await page.click('#shellVersions button[data-v="Asli"]');
  await page.waitForTimeout(400);
  await page.click('[data-tool-switch="meta"]');
  await page.waitForFunction(() => document.querySelector('input[data-field="exif:0x10f"]')?.value === "Canon", { timeout: 15000 });
  await page.waitForTimeout(400);
  note("makeValue", await fieldValue("exif:0x10f"));
  note("gpsRowExists", await fieldRowExists("gps"));
  note("jejakSection", await page.evaluate(() => document.getElementById("metaPanel").textContent.includes("Jejak")));
  note("scrubBtn", await page.evaluate(() => document.getElementById("metaScrub")?.textContent?.trim()));
  note("applyDisabledInitially", await page.evaluate(() => document.getElementById("metaApply").disabled));

  // (1) Edit Make "Canon" -> "Nikon" (muat in-place) -> Terapkan.
  await page.fill('input[data-field="exif:0x10f"]', "Nikon");
  await page.waitForTimeout(300);
  note("applyEnabledAfterEdit", await page.evaluate(() => !document.getElementById("metaApply").disabled));
  await page.click("#metaApply");
  await page.waitForFunction(() => (document.getElementById("metaStatus")?.textContent || "").includes("Perubahan diterapkan"), { timeout: 15000 });
  note("applyStatus", await metaStatus());
  note("makeValueAfter", await fieldValue("exif:0x10f"));
  note("versionAfterApply", await page.evaluate(() => document.getElementById("shellVersions")?.textContent?.replace(/\s+/g, " ").trim()));

  // (2) Hapus GPS -> Terapkan -> baris GPS hilang, Make tetap Nikon.
  await page.click('button[data-del="gps"]');
  await page.waitForTimeout(300);
  await page.click("#metaApply");
  await page.waitForFunction(() => (document.getElementById("metaStatus")?.textContent || "").includes("Perubahan diterapkan"), { timeout: 15000 });
  note("gpsRowAfterDelete", await fieldRowExists("gps"));
  note("makeValueAfterGpsDelete", await fieldValue("exif:0x10f"));

  // (3) "Hapus jejak" -> status sukses + versi Metadata.
  await page.click("#metaScrub");
  await page.waitForFunction(() => (document.getElementById("metaStatus")?.textContent || "").includes("Jejak dihapus"), { timeout: 15000 });
  note("scrubStatus", await metaStatus());
  note("versionAfterScrub", await page.evaluate(() => document.getElementById("shellVersions")?.textContent?.replace(/\s+/g, " ").trim()));

  // (4) Guard draft kotor — upload SEGAR (restart dulu): edit Model tanpa
  // Terapkan -> klik chip clean -> sheet muncul dengan tombol extra
  // "Buang perubahan" -> klik itu -> pindah ke clean, draft dibuang.
  // (Tidak bisa pakai file yang sama: clean auto-run saat pindah alat
  // sudah menghapus EXIF-nya, jadi tidak ada lagi field untuk diedit.)
  await page.click("#restartBtn");
  await page.waitForTimeout(400);
  await page.click("#sheetConfirm");
  await page.waitForTimeout(600);
  // Upload segar -> auto-clean -> chip meta -> versi Asli -> chip meta
  // lagi (panel membaca file asli, bukan hasil Bersihkan).
  await page.setInputFiles("#fileInput", [F("jejak-exif.jpg")]);
  await page.waitForFunction(() => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan foto");
  }, { timeout: 60000 });
  await page.click('[data-tool-switch="meta"]');
  await page.waitForFunction(() => !document.getElementById("metaPanel").classList.contains("hidden") && !!document.querySelector("#metaPanel .meta-row"), { timeout: 15000 });
  await page.click('#shellVersions button[data-v="Asli"]');
  await page.waitForTimeout(400);
  await page.click('[data-tool-switch="meta"]');
  await page.waitForFunction(() => document.querySelector('input[data-field="exif:0x10f"]')?.value === "Canon", { timeout: 15000 });
  await page.waitForTimeout(400);
  note("guardMakeValue", await fieldValue("exif:0x10f"));
  await page.fill('input[data-field="exif:0x110"]', "EOS R6");
  await page.waitForTimeout(300);
  await page.click('[data-tool-switch="clean"]');
  await page.waitForTimeout(500);
  note("sheetVisibleOnDirtySwitch", await page.evaluate(() => !document.getElementById("sheet").classList.contains("hidden")));
  note("sheetExtraVisible", await page.evaluate(() => !document.getElementById("sheetExtra").classList.contains("hidden")));
  note("sheetExtraLabel", await page.evaluate(() => document.getElementById("sheetExtra")?.textContent?.trim()));
  await page.click("#sheetExtra");
  await page.waitForTimeout(500);
  note("switchedToClean", await page.evaluate(() => document.querySelector('[data-tool-switch="clean"]').classList.contains("active")));
  note("sheetHiddenAfterDiscard", await page.evaluate(() => document.getElementById("sheet").classList.contains("hidden")));
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
writeFileSync(OUT, JSON.stringify(Object.fromEntries(log), null, 2));
console.log("DONE ->", OUT);
await ctx.close();
server.kill();
process.exit(0);
