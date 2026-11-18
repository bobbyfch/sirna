// Dependency-free local static server; Cloudflare routing and headers require preview:cloudflare.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.png':'image/png','.ico':'image/x-icon','.webp':'image/webp'};
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
    const segments = pathname.split('/');
    if (segments.some(s => s.startsWith('.')) || pathname.includes('\\')) { response.writeHead(403); response.end(); return; }
    let path = resolve(root, '.' + pathname);
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    const current = await stat(path).catch(() => null);
    if (current?.isDirectory()) path = resolve(path, 'index.html');
    const item = await stat(path).catch(() => null);
    if (!item?.isFile()) { path = resolve(root,'404.html'); response.statusCode = 404; }
    response.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(await readFile(path));
  } catch (error) { response.writeHead(500); response.end('Server error'); console.error(error); }
}).listen(port, '127.0.0.1', () => console.log(`Local dev: http://127.0.0.1:${port}/`));
