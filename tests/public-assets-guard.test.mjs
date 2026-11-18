import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {auditPublicAssets} from '../scripts/guard-public-assets.mjs';
test('normal public assets are permitted',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'starter-public-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'assets'));await writeFile(join(dir,'index.html'),'<main></main>');
 await writeFile(join(dir,'assets/site.css'),'body {}');
 assert.equal(await auditPublicAssets(dir),2);
});
test('source maps and development secrets fail closed',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'starter-private-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'app.js.map'),'{}');
 await assert.rejects(()=>auditPublicAssets(dir),/Public file leak/);
 await rm(join(dir,'app.js.map'));await writeFile(join(dir,'.env.production'),'dummy');
 await assert.rejects(()=>auditPublicAssets(dir),/Public file leak/);
});
