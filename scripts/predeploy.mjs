import { readFile, stat } from 'node:fs/promises';
const file = async path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const config = JSON.parse(await file('wrangler.jsonc'));
const pack = JSON.parse(await file('package.json'));
if (!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(config.name) || config.name === 'starter-not-configured') {
  throw new Error('Worker name is still a placeholder. Run: npm run setup -- my-project [domain.example.com]');
}
if (pack.name !== config.name) throw new Error('package.json name differs from Worker name; run setup');
if (Array.isArray(config.routes) && config.routes.length) {
  if (config.workers_dev !== false || config.routes.length !== 1 || config.routes[0].custom_domain !== true) throw new Error('Invalid custom-domain configuration');
}
const dist = await stat(new URL('../dist/index.html', import.meta.url)).catch(() => null);
if (!dist?.isFile()) throw new Error('Run npm run verify before deployment; dist/index.html not found');
console.log(`Deployment preflight passed for Worker '${config.name}'.`);
