// Conservative detection of common duplicate website deployments in Actions YAML.
// Best-effort guard; reviews must also inspect scripts and reusable workflows.
const patterns = [
  { reason: 'GitHub Pages / Wrangler deployment action', re: /(?:^|\n)\s*(?:-\s*)?uses:\s*['"]?(?:cloudflare\/wrangler-action|actions\/deploy-pages|peaceiris-actions\/gh-pages|jamesives\/github-pages-deploy-action)(?:@|['"\s]|$)/i },
  { reason: 'Wrangler site deployment from GitHub Actions', re: /\b(?:npx\s+(?:--yes\s+)?|pnpm\s+(?:dlx\s+)?|bunx\s+)?wrangler(?:@\S+)?\s+(?:pages\s+)?deploy\b/i },
  { reason: 'Site deploy script from GitHub Actions', re: /\b(?:npm\s+run\s+deploy(?::ci|:prod|:production)?|pnpm\s+(?:run\s+)?deploy(?::ci|:prod|:production)?|yarn\s+deploy|bun\s+run\s+deploy)(?:\s|$)/i },
  { reason: 'Direct GitHub Pages publish', re: /\b(?:gh-pages\s+-d|github-pages-deploy-action)\b/i }
];
export function detectDuplicateSiteDeploy(workflowText) {
  if (typeof workflowText !== 'string') throw new TypeError('Workflow must be text');
  return patterns.filter(item => item.re.test(workflowText)).map(item => item.reason);
}
