// Unit test reverse-alpha (src/revalpha.ts) — Node, tanpa DOM.
// Gambar uji: wm-gemini.png (sparkle Gemini asli di-blend dari alpha map
// yang sama, lihat tests/fixtures/gen-sparkle.mjs) harus terdeteksi +
// ter-unblend pulih (±2/kanal); wm-clean.png harus null; wm-test.png
// (bintang putih gambar tangan, bukan sparkle Gemini) harus null.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng } from './fixtures/png-io.mjs';
import { ensureWatermarkFixtures } from './fixtures/bootstrap.mjs';
await ensureWatermarkFixtures();

// Node tidak punya ImageData global — polyfill minimal (removeSparkle
// hanya memakai konstruktor + .data/.width/.height).
if (!('ImageData' in globalThis)) {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      if (data instanceof Uint8ClampedArray) { this.data = data; this.width = width; this.height = height; }
      else { this.width = data; this.height = width; this.data = new Uint8ClampedArray(data * width); }
    }
  };
}

// Compile with the CLI checked out by Cloudflare Builds; no hard-coded cwd or /tmp location.
const root = fileURLToPath(new URL('../', import.meta.url));
const testDir = mkdtempSync(join(tmpdir(), 'sirna-watermark-'));
writeFileSync(join(testDir, 'package.json'), '{"type":"module"}');
const compile = spawnSync(join(root, 'node_modules/.bin/tsc'),
  ['src/revalpha.ts', '--ignoreConfig', '--module', 'esnext',
   '--moduleResolution', 'bundler', '--target', 'es2022', '--outDir', testDir, '--skipLibCheck'],
  { cwd: root, encoding: 'utf8' });
assert.equal(compile.status, 0, 'Watermark test compilation failed:\n' + compile.stdout + compile.stderr);
const { detectGeminiSparkle, removeSparkle, nccScore, getAlphaMap } =
  await import(pathToFileURL(join(testDir, 'revalpha.js')).href);

function toImgLike(png) {
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}

test('sparkle Gemini asli terdeteksi di kotak kanonis 48px', async () => {
  const img = toImgLike(decodePng(readFileSync(new URL('./fixtures/wm-gemini.png', import.meta.url))));
  const hit = detectGeminiSparkle(img);
  assert.ok(hit, 'sparkle harus terdeteksi');
  assert.equal(hit.size, 48);
  assert.ok(Math.abs(hit.box.x - 720) <= 16 && Math.abs(hit.box.y - 520) <= 16, 'box harus di sekitar (720,520), dapat ' + hit.box.x + ',' + hit.box.y);
  assert.ok(hit.score >= 0.6, 'skor NCC >= 0.60, dapat ' + hit.score.toFixed(3));
  assert.equal(hit.darkBg, false);
});

test('unblend memulihkan piksel asli (±2/kanal), luar box byte-identical', async () => {
  const clean = decodePng(readFileSync(new URL('./fixtures/wm-clean.png', import.meta.url)));
  const wm = toImgLike(decodePng(readFileSync(new URL('./fixtures/wm-gemini.png', import.meta.url))));
  const hit = detectGeminiSparkle(wm);
  assert.ok(hit);
  const { image, unrecoverable } = removeSparkle(wm, hit);
  assert.equal(unrecoverable, 0);
  let worst = 0, bad = 0;
  for (let y = 0; y < 600; y++) {
    for (let x = 0; x < 800; x++) {
      const p = (y * 800 + x) * 4;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(image.data[p + c] - clean.data[p + c]);
        if (d > worst) worst = d;
        if (d > 2) bad++;
      }
    }
  }
  assert.equal(bad, 0, `piksel menyimpang >2: ${bad}, worst=${worst}`);
  assert.equal(worst <= 2, true);
});

test('foto bersih -> null; bintang putih gambar tangan -> null (jujur, bukan nebak)', async () => {
  const clean = toImgLike(decodePng(readFileSync(new URL('./fixtures/wm-clean.png', import.meta.url))));
  assert.equal(detectGeminiSparkle(clean), null);
  const fake = toImgLike(decodePng(readFileSync(new URL('./fixtures/wm-test.png', import.meta.url))));
  assert.equal(detectGeminiSparkle(fake), null);
  // NCC bintang palsu memang rendah — buktikan angkanya di bawah ambang.
  const alpha = getAlphaMap(48);
  const score = nccScore(fake, { x: 720, y: 520, w: 48, h: 48 }, alpha);
  assert.ok(score < 0.6, 'skor bintang palsu harus < 0.60, dapat ' + score.toFixed(3));
});
