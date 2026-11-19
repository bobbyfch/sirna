// Matriks label 23 kasus (Langkah 1 — verifikasi fix 8052eebb).
// Semua file di tests/fixtures/matrix/ membawa label OpenAI/DALL·E +
// manifest C2PA di SATU container (12 PNG + 10 JPEG + 1 PNG-bernama-JPEG).
// Batch upload -> tiap kartu HARUS berakhir pill "Sudah bersih" +
// kotak "Beres — sudah bersih" + bukti (0 label AI tersisa, ukuran
// sebelum -> sesudah, "File ini aman diunggah."). Stats + batch bar
// juga dicek (satu sumber kebenaran: getFileState).
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://127.0.0.1:4173/";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const DIR = new URL("./fixtures/matrix/", import.meta.url).pathname;
const FILES = readdirSync(DIR).sort().map((f) => join(DIR, f));
const OUT = "/tmp/matrix-e2e-result.json";
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

try {
  note("files", FILES.length);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  // Pilih alat dulu (arah 19 Nov 2026: tanpa alat, file cuma diantre —
  // tidak ada lagi auto-pilih Bersihkan).
  await page.click('[data-tool="clean"]');
  await page.waitForTimeout(500);
  await page.setInputFiles("#fileInput", FILES);
  // Tunggu semua 23 kartu selesai: tombol Simpan muncul per kartu.
  // Tunggu tombol utama jadi "Simpan semua (N)" — Simpan per kartu
  // sudah dihapus (prinsip C).
  await page.waitForFunction((n) => {
    const b = document.getElementById("primaryBtn");
    return b && !b.classList.contains("hidden") && b.textContent.includes("Simpan semua (" + n + ")");
  }, FILES.length, { timeout: 120000 });
  await page.waitForTimeout(500);
  const states = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("#list article"));
    return cards.map((c) => {
      const name = c.querySelector("h4")?.textContent || "?";
      const pill = c.querySelector(".status-pill")?.textContent?.trim() || "?";
      const box = c.querySelector("#result-" + c.id.replace("card-", ""))?.textContent || "";
      const boxEl = c.querySelector(".clean-box, .detect-box");
      return { name, pill, head: boxEl?.querySelector(".clean-head, .detect-head")?.textContent?.trim() || "", body: boxEl?.querySelector(".clean-body")?.textContent?.trim() || "" };
    });
  });
  const bad = states.filter((s) => s.pill !== "Sudah bersih" || !s.head.includes("Beres — sudah bersih") || !s.body.includes("0 label AI tersisa") || !s.body.includes("→") || !s.body.includes("File ini aman diunggah."));
  note("matrixBad", bad);
  note("matrixPass", states.length - bad.length + "/" + states.length);
  for (const s of states) if (bad.includes(s)) note("BAD:" + s.name, s.pill + " | " + s.head + " | " + s.body.slice(0, 120));
  note("statsText", await page.locator("#statsText").textContent());
  note("batchStats", await page.locator("#batchStats").textContent());
  note("batchBarVisible", await page.evaluate(() => !document.getElementById("batchBar").classList.contains("hidden")));
  note("toast", await page.locator("#toast").textContent());
} catch (e) {
  note("ERROR", String(e && e.stack || e));
}
note("consoleErrors", consoleErrors.slice(0, 10));
note("pageErrors", pageErrors.slice(0, 10));
await browser.close();
server.kill();
writeFileSync(OUT, JSON.stringify(log, null, 2));
console.log("DONE ->", OUT);
