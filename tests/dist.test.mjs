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
