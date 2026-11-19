// Sirna inspector contract: C2PA is a structural hint, never a signature
// verification. Fixtures are generated in memory; no Pillow or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodePng, chunk } from './fixtures/png-io.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=mkdtempSync(join(tmpdir(),'sirna-inspection-'));
writeFileSync(join(temporary,'package.json'),'{"type":"module"}');
const compile=spawnSync(join(root,'node_modules/.bin/tsc'),
  ['src/inspection.ts','src/jejak.ts','--ignoreConfig',
   '--module','esnext','--moduleResolution','bundler',
   '--target','es2022','--outDir',temporary,'--skipLibCheck'],
  {cwd:root,encoding:'utf8'});
assert.equal(compile.status,0,'Inspector compile failed: '+compile.stdout+compile.stderr);
const compiled=join(temporary,'inspection.js');
writeFileSync(compiled,readFileSync(compiled,'utf8')
  .replaceAll('from "./jejak"','from "./jejak.js"')
  .replaceAll("from './jejak'","from './jejak.js'"));
const {inspectFile,integrityOf}=await import(pathToFileURL(compiled).href);

function png(extra=[]){
  const raw=encodePng({width:1,height:1,data:Buffer.from([1,2,3,255])});
  return Buffer.concat([raw.subarray(0,raw.length-12),...extra,raw.subarray(raw.length-12)]);
}
test('Clean PNG: no invented Content Credentials or AI identity',async()=>{
  const bytes=png();
  const info=await inspectFile(new Blob([bytes],{type:'image/png'}),'photo.png');
  assert.equal(info.mime,'image/png');
  assert.equal(info.credentials,'not-seen');
  assert.equal(info.traces.length,0);
  assert.equal(info.limited,false);
});
test('PNG caBX: container recognized without claiming verified signature',async()=>{
  const bytes=png([chunk('caBX',Buffer.from('fixture c2pa untrusted'))]);
  const info=await inspectFile(new Blob([bytes],{type:'image/png'}),'image.png');
  assert.equal(info.credentials,'embedded');
  assert.match(info.credentialEvidence,/belum divalidasi/);
  assert.ok(info.risks.includes('Content Credentials'));
});
test('Integrity distinguishes size, MIME and unverified resolution',async()=>{
  const a=await inspectFile(new Blob([png()],{type:'image/png'}),'a.png');
  const b=await inspectFile(new Blob([png([chunk('tEXt',Buffer.from('Software\0demo'))])],{type:'image/png'}),'a.png');
  const summary=integrityOf(a,b,true);
  assert.equal(summary.bytes,'pixel-data-preserved');
  assert.equal(summary.resolution,'unverified'); // Node has no image decoder
  assert.equal(summary.mimeChange,false);
  assert.ok(summary.resultSize>summary.originalSize);
  assert.ok(summary.remaining>0);
});
test('Unsupported HEIC-like container is inspected honestly',async()=>{
  const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypheic'),Buffer.alloc(12)]);
  const info=await inspectFile(new Blob([bytes],{type:'image/heic'}),'sample.heic');
  assert.equal(info.mime,'image/heic');
  assert.equal(info.dimensions,null);
});
