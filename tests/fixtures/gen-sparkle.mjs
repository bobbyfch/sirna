// Generate tests/fixtures/wm-gemini.png: foto wm-clean.png (800x600) +
// sparkle Gemini ASLI (alpha map 48px dari src/revalpha.ts) di-blend
// putih di kotak kanonis deteksi (x=800-32-48=720, y=600-32-48=520),
// rumus blend yang sama dengan yang dipakai Gemini:
//   wm = bg*(1-a) + 255*a
// Jadi removeSparkle() harus memulihkan piksel aslinya (±2/kanal).
// Jalankan: node tests/fixtures/gen-sparkle.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "./png-io.mjs";

const src = readFileSync(new URL("../../src/revalpha.ts", import.meta.url), "utf8");
const m = src.match(/ALPHA_48_B64\s*=\s*((?:"[^"]*"\s*\+?\s*)+);/);
if (!m) throw new Error("ALPHA_48_B64 tidak ketemu di src/revalpha.ts");
const b64 = m[1].replace(/"/g, "").replace(/\+/g, "").replace(/\s+/g, "");
const alpha = Buffer.from(b64, "base64");
if (alpha.length !== 48 * 48) throw new Error("alpha 48 panjangnya " + alpha.length);

const clean = decodePng(readFileSync(new URL("./wm-clean.png", import.meta.url)));
const { width: W, height: H } = clean;
const out = { width: W, height: H, data: Buffer.from(clean.data) };
const bx = W - 32 - 48, by = H - 32 - 48; // kotak kanonis 48px (lihat canonicalBox di revalpha.ts)
for (let y = 0; y < 48; y++) {
  for (let x = 0; x < 48; x++) {
    const a = alpha[y * 48 + x] / 255;
    if (a <= 0) continue;
    const p = ((by + y) * W + (bx + x)) * 4;
    for (let c = 0; c < 3; c++) out.data[p + c] = Math.round(out.data[p + c] * (1 - a) + 255 * a);
  }
}
writeFileSync(new URL("./wm-gemini.png", import.meta.url), encodePng(out));
console.log("wrote wm-gemini.png", W + "x" + H, "sparkle box", bx + "," + by, "alpha max", Math.max(...alpha) / 255);
