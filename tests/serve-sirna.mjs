// Server HTTPS statis buat e2e (persisten, di dalam repo — /tmp sempat
// ter-wipe dua kali). Serve dist/ lokal saja. CSP = salinan public/_headers
// (single-engine 19 Nov 2026: connect-src mengizinkan huggingface.co +
// cdn-lfs.huggingface.co untuk unduhan model; COOP/COEP untuk SAB/WASM
// multi-thread). Sertifikat self-signed khusus tes ada di tests/fixtures/
// (bukan kredensial).
import { createServer } from "node:https";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2], PORT = Number(process.argv[3] || 4173);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' https://huggingface.co https://cdn-lfs.huggingface.co; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
createServer({ key: readFileSync(join(HERE, "fixtures/key.pem")), cert: readFileSync(join(HERE, "fixtures/cert.pem")) }, (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "https://x").pathname);
  if (p === "/") p = "/index.html";
  let file = join(ROOT, p);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, {
    "content-type": MIME[extname(file)] || "application/octet-stream",
    "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless",
    "Content-Security-Policy": CSP, "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  });
  res.end(readFileSync(file));
}).listen(PORT, "127.0.0.1", () => console.log("serving", ROOT, "on", PORT));
