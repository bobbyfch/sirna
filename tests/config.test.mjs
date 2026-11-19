import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
const read = async path => readFile(new URL(`../${path}`, import.meta.url),'utf8');
test('Worker static assets and branch-safe deployment scripts', async () => {
  const config=JSON.parse(await read('wrangler.jsonc'));
  const pkg=JSON.parse(await read('package.json'));
  assert.equal(config.assets.directory,'./dist');
  assert.equal(config.assets.not_found_handling,'404-page');
  assert.match(pkg.scripts['deploy:ci'],/predeploy/);
  assert.match(pkg.scripts['deploy:ci'],/wrangler@4\.153\.0/);
  assert.equal(pkg.private,true);
});
test('Security headers and non-indexed template', async () => {
  const headers=await read('public/_headers');
  assert.match(headers,/Content-Security-Policy:/);
  assert.match(headers,/X-Content-Type-Options: nosniff/);
  // Migrasi Vite: Tailwind + JSZip dibundel — CSP tidak boleh lagi nyebut CDN.
  assert.doesNotMatch(headers,/cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com/);
  const config=JSON.parse(await read('wrangler.jsonc'));
  if (config.name === 'starter-not-configured') {
    assert.match(await read('public/robots.txt'),/Disallow: \//);
    assert.match(await read('public/index.html'),/name="robots" content="noindex, nofollow"/);
  }
});

test('Critical UI controls remain wired and the file picker has native fallback', async () => {
  const app=await read('src/app.ts');
  const html=await read('index.html');
  // A single-element querySelector cannot be iterated: previously it crashed
  // initialization and disabled BOTH the theme and upload handlers.
  assert.doesNotMatch(app, /(?<!\$)\$\([^\n)]+\)\.forEach\s*\(/);
  assert.match(app, /\$\$\("\[data-clean-profile\]"\)\.forEach/);
  assert.match(app, /themeBtn[\s\S]*?addEventListener\("click"/);
  assert.match(app, /fi\.addEventListener\("change"/);
  assert.match(html, /<label[^>]*id="pickLabel"[^>]*for="fileInput"/);
  for(const id of ['themeBtn','dropZone','fileInput','folderInput','videoInput']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
});
