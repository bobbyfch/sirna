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
  const config=JSON.parse(await read('wrangler.jsonc'));
  if (config.name === 'starter-not-configured') {
    assert.match(await read('public/robots.txt'),/Disallow: \//);
    assert.match(await read('public/index.html'),/name="robots" content="noindex, nofollow"/);
  }
});
