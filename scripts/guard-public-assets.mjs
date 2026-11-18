import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function auditPublicAssets(root){
  let count=0;const bad=[];
  async function walk(folder,prefix=''){
    for(const e of await readdir(folder,{withFileTypes:true})){
      const name=prefix?prefix+'/'+e.name:e.name,lower=name.toLowerCase();
      if(e.isSymbolicLink()){bad.push(name+' (symlink)');continue}
      if(e.isDirectory()){await walk(join(folder,e.name),name);continue}
      if(!e.isFile()){bad.push(name+' (special file)');continue}
      count++;
      const parts=lower.split('/'),file=parts.at(-1);
      if(lower.endsWith('.map')||
         parts.some(p=>['.git','.github','node_modules','src','scripts','.wrangler'].includes(p))||
         /^\.env(?:\..+)?$/.test(file)||/^\.dev\.vars(?:\..+)?$/.test(file)||
         ['.npmrc','package.json','package-lock.json','pnpm-lock.yaml','yarn.lock','wrangler.json','wrangler.jsonc','wrangler.toml','tsconfig.json'].includes(file)||
         ['id_rsa','id_ed25519'].includes(file)||/\.(?:pem|key|p12|pfx)$/.test(file))
        bad.push(name);
    }
  }
  await walk(root);
  assert.deepEqual(bad,[],'Public file leak: source maps, private keys or development files');
  return count;
}
async function main(){
  const n=await auditPublicAssets(resolve('dist'));
  console.log('Static output guard passed: '+n+' files, no source maps or private config.');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(e=>{console.error(e.message);process.exitCode=1});
