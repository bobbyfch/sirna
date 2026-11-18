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
