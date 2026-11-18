import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const source = resolve(root, 'public');
const output = resolve(root, 'dist');
const src = await stat(source).catch(() => null);
if (!src?.isDirectory()) throw new Error('Missing public/ source directory');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, force: true, errorOnExist: false, filter: async path => {
  // Don't publish local secrets or dotfiles accidentally. _headers is intentional.
  const relative = path.slice(source.length).replaceAll('\\', '/');
  return !relative.split('/').some(segment => segment.startsWith('.') && segment !== '.' && segment !== '..');
}});
const entries = await readdir(output);
if (!entries.includes('index.html') || !entries.includes('404.html') || !entries.includes('_headers')) throw new Error('Build did not produce required assets');
console.log(`Built ${entries.length} top-level entries into dist/`);
