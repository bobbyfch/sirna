// Static starter source checks plus framework-agnostic deployment safety.
// Adaptasi Sirna (dari template bobbyfch/cloudflare-starter):
// - 'AGENTS.md' dihapus dari daftar wajib: Sirna tidak menyalin AGENTS.md
//   template (dan AGENTS.md artefak Sirna berisi instruksi builder, bukan
//   aturan repo). - 'public/assets/site.css' dihapus: Sirna tidak punya
//   stylesheet terpisah (Tailwind via CDN + <style> inline).
import { access, readFile, readdir } from 'node:fs/promises';
import { detectDuplicateSiteDeploy } from './workflow-policy.mjs';
const root = new URL('../', import.meta.url);
const file = async name => readFile(new URL(name, root), 'utf8');
const required = ['README.md', 'wrangler.jsonc', 'package.json', 'package-lock.json'];
for (const path of required) await access(new URL(path, root));
const config = JSON.parse(await file('wrangler.jsonc'));
const pack = JSON.parse(await file('package.json'));
const lock = JSON.parse(await file('package-lock.json'));
if (pack.name !== lock.name || pack.version !== lock.version) throw new Error('package.json and package-lock.json mismatch');
if (typeof config.name !== 'string' || !config.name.trim()) throw new Error('Missing Wrangler Worker name');
const projectConfig = await readFile(new URL('project.config.json', root),'utf8').then(JSON.parse).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
if (projectConfig) {
  if (projectConfig.schema_version !== 1 || projectConfig.name !== config.name ||
      !['site','app','cdn','api'].includes(projectConfig.security_profile)) {
    throw new Error('Invalid project.config.json; setup and Wrangler must agree');
  }
}
if (pack.scripts?.['deploy:ci']?.includes('github') || pack.scripts?.['deploy:ci']?.includes('pages')) throw new Error('Legacy deployment reference');
if (config.assets?.not_found_handling !== undefined && !['404-page', 'single-page-application', 'none'].includes(config.assets.not_found_handling)) throw new Error('Invalid asset not-found handling');

// Starter's bundled static asset requirements apply only while its copy build is in use.
// Framework migrations must deliberately update/replace their own tests and deploy gates.
const starterStaticBuild = /(?:^|\s)node\s+(?:\.\/)?scripts\/build\.mjs(?:\s|$)/.test(pack.scripts?.build ?? '');
if (starterStaticBuild) {
  if (config.assets?.directory !== './dist') throw new Error('Static starter must deploy ./dist');
  for (const path of ['public/index.html', 'public/404.html', 'public/_headers']) await access(new URL(path, root));
  const robots = await file('public/robots.txt');
  if (config.name === 'starter-not-configured' && !robots.includes('Disallow: /')) throw new Error('Unconfigured template must be noindex');
}
const actions = new URL('.github/workflows/', root);
const workflows = await readdir(actions).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e));
for (const workflow of workflows.filter(f => /\.ya?ml$/i.test(f))) {
  const violations = detectDuplicateSiteDeploy(await readFile(new URL(workflow, actions), 'utf8'));
  if (violations.length) throw new Error(`Duplicate site deployment workflow (${workflow}): ${violations.join('; ')}`);
}
console.log('Source and single-website-deployment checks passed' + (starterStaticBuild ? ' (static starter)' : ' (adapted project)'));
