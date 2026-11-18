// Adaptasi Sirna dari tests/dist.test.mjs template bobbyfch/cloudflare-starter:
// - 'favicon.svg' dihapus dari daftar wajib: Sirna tidak punya favicon.svg
//   (favicon-nya inline data: SVG di index.html).
// - Pemeriksaan 'assets/site.css' diganti: Sirna tidak punya stylesheet
//   terpisah; yang diverifikasi adalah aset yang memang dipakai halaman —
//   sw.js root, manifest.webmanifest, dan satu logo.
// - 'sw.js' ditambahkan ke daftar wajib tingkat atas dist/ (service worker
//   root, scope seluruh situs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
const dir = new URL('../dist/', import.meta.url);
test('Production build exposes only public assets', async () => {
  const names=await readdir(dir);
  for(const name of ['index.html','404.html','_headers','robots.txt','assets','sw.js']) assert.ok(names.includes(name),`Missing ${name}`);
  for(const name of ['AGENTS.md','package.json','.env','scripts','node_modules','wrangler.jsonc']) assert.equal(names.includes(name),false,`Source accidentally published: ${name}`);
  assert.ok((await stat(new URL('assets/sw.js',dir))).size > 100);
  assert.ok((await stat(new URL('assets/manifest.webmanifest',dir))).size > 100);
  assert.ok((await stat(new URL('assets/logos/chatgpt.png',dir))).size > 100);
  assert.match(await readFile(new URL('index.html',dir),'utf8'),/<main/);
});
test('Hapus Objek: editor shell ada, model lazy-load, semua file di bawah batas deploy', async () => {
  const html = await readFile(new URL('index.html',dir),'utf8');
  assert.match(html, /Hapus Objek/);
  assert.match(html, /id="eraseModal"/);
  assert.match(html, /data-erase-mode="instant"/);
  assert.match(html, /data-erase-mode="migan"/);
  assert.match(html, /data-erase-mode="lama"/);
  // Runtime wasm onnxruntime-web disalin build ke assets/ort/ (bukan precache SW).
  const ort = await readdir(new URL('assets/ort',dir));
  assert.ok(ort.includes('ort-wasm-simd-threaded.wasm'), 'Missing ort wasm');
  assert.ok(ort.includes('ort-wasm-simd-threaded.mjs'), 'Missing ort wasm glue');
  // Cloudflare Workers: file statis maks 25 MiB — nggak ada file dist yang boleh lewat.
  const LIMIT = 25 * 1024 * 1024;
  async function walk(u) {
    const out = [];
    for (const e of await readdir(u, { withFileTypes: true })) {
      const c = new URL(e.name, u.href.endsWith('/') ? u : new URL(u.href + '/'));
      if (e.isDirectory()) out.push(...await walk(c));
      else out.push(c);
    }
    return out;
  }
  for (const f of await walk(dir)) {
    const s = await stat(f);
    assert.ok(s.size <= LIMIT, `${f.pathname} = ${s.size} byte, lewat batas 25 MiB Cloudflare`);
  }
  // Aturan lazy-load Bobby: URL model AI & onnxruntime HARUS ada di chunk
  // terpisah (erase-*), dan TIDAK BOLEH ada di chunk utama (index-* / main).
  // Kalau ada di chunk utama, model ikut keunduh pas load pertama.
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  const main = js.filter(n => /^index-/.test(n) || /^main-/.test(n));
  assert.ok(main.length >= 1, 'Missing main entry chunk');
  let mainBundle = '';
  for (const f of main) mainBundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.doesNotMatch(mainBundle, /huggingface\.co|migan_pipeline|lama_fp32|onnxruntime/);
  let all = '';
  for (const f of js) all += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.match(all, /migan_pipeline_v2\.onnx/); // chunk erase ada (lazy)
  assert.match(all, /lama_fp32\.onnx/);
});
test('Hapus Watermark: hero step ada, deteksi lazy-load, model tetap di chunk erase', async () => {
  const html = await readFile(new URL('index.html',dir),'utf8');
  assert.match(html, /Hapus Watermark/);
  assert.match(html, /id="eraseTitle"/); // judul modal diatur pas dibuka (Objek / Watermark)
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  const main = js.filter(n => /^index-/.test(n) || /^main-/.test(n));
  assert.ok(main.length >= 1, 'Missing main entry chunk');
  let mainBundle = '';
  for (const f of main) mainBundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  // Detektor watermark tinggal di chunk lazy-nya sendiri (watermark-*),
  // bukan di chunk utama — buka halaman tidak ikut memuat logika deteksi.
  assert.doesNotMatch(mainBundle, /detectWatermark/);
  assert.doesNotMatch(mainBundle, /huggingface\.co|migan_pipeline|lama_fp32|onnxruntime/);
  let all = '';
  for (const f of js) all += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.match(all, /detectWatermark/); // chunk watermark ada (lazy)
  // Model AI tetap cuma di chunk erase (lazy) — chunk watermark tidak
  // membawa URL model sama sekali.
  const wm = js.filter(n => /^watermark-/.test(n));
  assert.ok(wm.length >= 1, 'Missing watermark chunk');
  let wmBundle = '';
  for (const f of wm) wmBundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.doesNotMatch(wmBundle, /huggingface\.co|migan_pipeline|lama_fp32|onnxruntime/);
});
test('Vite build output: bundled JS/CSS, no CDN, preserved fixes', async () => {
  const html = await readFile(new URL('index.html',dir),'utf8');
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  const css = assets.filter(n => n.endsWith('.css'));
  assert.ok(js.length >= 1, 'Missing bundled JS');
  assert.ok(css.length >= 1, 'Missing bundled CSS');
  // Tailwind + JSZip dibundel: tidak ada lagi referensi CDN di output.
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com/);
  let bundle = '';
  for (const f of js) bundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.doesNotMatch(bundle, /cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com/);
  assert.match(bundle, /serviceWorker/);
  assert.match(bundle, /register\(["'`]sw\.js["'`]\)/); // esbuild minify bisa jadi template literal
  // Perilaku & fix Bobby yang harus selamat dari migrasi:
  assert.match(html, /© 2026 Bobby Fajar Christian · Bagian dari semesta limaraya\.com/);
  assert.match(html, /sosmed nggak lagi nganggep fotomu konten AI/);
  assert.doesNotMatch(bundle, /lavf|ffmpeg/); // 39bea0f: signature false positive dihapus
  // Identifier lokal di-minify esbuild, jadi yang diasersi adalah literal
  // string yang selamat dari minify dan membuktikan logikanya ada:
  assert.match(bundle, /Belum terverifikasi/); // verifyState jujur: Bersih / Label tersisa / Belum terverifikasi
  assert.match(bundle, /Label tersisa/);
  assert.match(bundle, /tEXt/); // strip lossless Format=Asli (drop chunk tEXt/iTXt/zTXt/eXIf/jumb)
  assert.match(bundle, /`TB`,`PB`/); // formatBytes lengkap (B/KB/MB/GB/TB/PB)
});
