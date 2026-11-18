// Adaptasi Sirna dari tests/setup.test.mjs template bobbyfch/cloudflare-starter:
// ekor test yang menyalin & menjalankan scripts/security-baseline.mjs
// dihapus — script planner itu sengaja tidak disalin ke repo Sirna, jadi
// asersi profil/host hasil security:plan tidak berlaku di sini. Inti test
// (satu perintah setup memperbarui nama, domain, dan lock secara bersamaan)
// dipertahankan apa adanya.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const source=fileURLToPath(new URL('../',import.meta.url));
test('One-command setup updates name, domain and lock together', async t => {
  const temp=await mkdtemp(join(tmpdir(),'starter-test-'));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  for(const path of ['package.json','package-lock.json','wrangler.jsonc']) await cp(join(source,path),join(temp,path));
  await cp(join(source,'index.html'),join(temp,'index.html'));
  await cp(join(source,'scripts/setup.mjs'),join(temp,'scripts/setup.mjs'),{recursive:true,force:true});
  // Each generated website runs its own tests after setup. Recreate an untouched
  // starter fixture rather than assuming the current repository is unconfigured.
  const templateName='cloudflare-starter';
  const workerFile=join(temp,'wrangler.jsonc');
  const packageFile=join(temp,'package.json');
  const lockFile=join(temp,'package-lock.json');
  const htmlFile=join(temp,'index.html');
  const worker=JSON.parse(await readFile(workerFile,'utf8'));
  worker.name='starter-not-configured'; worker.workers_dev=true; delete worker.routes;
  const pkg=JSON.parse(await readFile(packageFile,'utf8')); pkg.name=templateName;
  const lock=JSON.parse(await readFile(lockFile,'utf8')); lock.name=templateName; lock.packages[''].name=templateName;
  await writeFile(workerFile,JSON.stringify(worker,null,2)+'\n');
  await writeFile(packageFile,JSON.stringify(pkg,null,2)+'\n');
  await writeFile(lockFile,JSON.stringify(lock,null,2)+'\n');
  const page=await readFile(htmlFile,'utf8');
  await writeFile(htmlFile,page.replace(/<title>.*?<\/title>/,'<title>__SITE_NAME__</title>'));
  execFileSync(process.execPath,[join(temp,'scripts/setup.mjs'),'nice-project','nice.example.com','--profile','app']);
  const w=JSON.parse(await readFile(join(temp,'wrangler.jsonc'),'utf8'));
  const p=JSON.parse(await readFile(join(temp,'package.json'),'utf8'));
  const l=JSON.parse(await readFile(join(temp,'package-lock.json'),'utf8'));
  assert.equal(w.name,'nice-project'); assert.equal(p.name,w.name); assert.equal(l.name,w.name); assert.equal(l.packages[''].name,w.name);
  assert.equal(w.routes[0].pattern,'nice.example.com'); assert.equal(w.workers_dev,false);
  const profile = JSON.parse(await readFile(join(temp,'project.config.json'),'utf8'));
  assert.equal(profile.name,'nice-project'); assert.equal(profile.security_profile,'app');
  assert.match(await readFile(join(temp,'index.html'),'utf8'),/<title>Nice Project<\/title>/);
  assert.throws(()=>execFileSync(process.execPath,[join(temp,'scripts/setup.mjs'),'different-project'],{stdio:'pipe'}));
  assert.throws(()=>execFileSync(process.execPath,[join(temp,'scripts/setup.mjs'),'nice-project','nice.example.com','--profile','cdn'],{stdio:'pipe'}));
});
