import { readFile, writeFile } from 'node:fs/promises';
const help = 'Usage: npm run setup -- <worker-name> [subdomain.example.com] [--profile site|app|cdn|api]';
const input = process.argv.slice(2);
if (input.includes('--help') || input.includes('-h')) { console.log(help); process.exit(0); }
const args = [];
let profile = 'site';
for (let i=0; i<input.length; i++) {
  if (input[i] === '--profile') {
    if (!input[i+1] || input[i+1].startsWith('--')) throw new Error(help);
    profile = input[++i];
  } else if (input[i].startsWith('--')) throw new Error(help);
  else args.push(input[i]);
}
if (args.length < 1 || args.length > 2) throw new Error(help);
if (!['site','app','cdn','api'].includes(profile)) throw new Error('Invalid project security profile');
const [name, domain] = args;
const workerName = /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/;
const hostName = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
if (!workerName.test(name) || name === 'starter-not-configured') throw new Error('Use a lowercase Worker name (3–63 characters: a–z, 0–9, hyphen, not ending in hyphen).');
if (domain && !hostName.test(domain)) throw new Error('Use a full lowercase hostname, such as site.example.com.');
const paths = Object.fromEntries(['package.json','package-lock.json','wrangler.jsonc'].map(path => [path,new URL(`../${path}`,import.meta.url)]));
const pkg = JSON.parse(await readFile(paths['package.json'], 'utf8'));
const lock = JSON.parse(await readFile(paths['package-lock.json'], 'utf8'));
const wrangler = JSON.parse(await readFile(paths['wrangler.jsonc'], 'utf8'));
if (wrangler.name !== 'starter-not-configured' && wrangler.name !== name) throw new Error(`Project is already configured as '${wrangler.name}'. Do not overwrite an existing deployment.`);
if (domain && wrangler.routes?.length && wrangler.routes[0]?.pattern !== domain) throw new Error('Custom domain already configured. Edit wrangler.jsonc manually after checking Cloudflare.');
const profilePath = new URL('../project.config.json', import.meta.url);
const currentProfile = await readFile(profilePath, 'utf8').then(JSON.parse).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
if (currentProfile && (currentProfile.security_profile !== profile || currentProfile.name !== name)) {
  throw new Error('Existing project profile differs; do not silently change a configured project.');
}
pkg.name = name;
lock.name = name;
if (lock.packages?.['']) lock.packages[''].name = name;
wrangler.name = name;
if (domain) { wrangler.workers_dev = false; wrangler.routes = [{pattern:domain,custom_domain:true}]; }
await writeFile(paths['package.json'], JSON.stringify(pkg,null,2)+'\n');
await writeFile(paths['package-lock.json'], JSON.stringify(lock,null,2)+'\n');
await writeFile(paths['wrangler.jsonc'], JSON.stringify(wrangler,null,2)+'\n');
await writeFile(profilePath, JSON.stringify({schema_version:1,name,security_profile:profile},null,2)+'\n');
const htmlPath = new URL('../public/index.html', import.meta.url);
const html = await readFile(htmlPath,'utf8');
const title = name.split('-').map(x=>x[0].toUpperCase()+x.slice(1)).join(' ');
await writeFile(htmlPath,html.replaceAll('__SITE_NAME__',title));
console.log(`Configured '${name}'${domain?` for ${domain}`:' for a workers.dev preview'}. No Cloudflare deployment was performed.`);
