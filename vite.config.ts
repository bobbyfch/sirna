import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

/* Sirna — Vite + TypeScript + Tailwind v4. Output tetap file statis untuk
   Cloudflare Workers Static Assets (wrangler.jsonc: assets ./dist).
   base './' supaya hasil build tetap pakai path relatif seperti dulu —
   halaman bisa disajikan dari root domain tanpa asumsi base absolut.
   SATU runtime AI: onnxruntime-web 1.31.1 (Mi-GAN, ORMBG, Real-ESRGAN).
   ORT hanya diimpor di Web Worker (src/ai-worker.ts) — main bundle
   tidak membawa onnxruntime. File .wasm/.mjs ORT disalin ke dist/ort/
   saat build (plugin sirna-ort-wasm di bawah) dan dilayani di /ort/
   saat dev — ORT mengambil wasm-nya dari `ort.env.wasm.wasmPaths`. */

const require = createRequire(import.meta.url);
// Entry point ORT (dist/ort.bundle.min.mjs) — dirname-nya = dist ORT.
// (package.json tidak diekspor lewat "exports", jadi jangan resolve itu.)
const ortDist = dirname(require.resolve("onnxruntime-web"));

/* Salin HANYA file WASM yang dipakai ke dist/ort/:
   ort-wasm-simd-threaded.wasm (14,8 MB) + .mjs-nya.
   SENGAJA tidak menyalin varian jsep/asyncify/jspi: jsep 29,5 MB dan
   asyncify 28,7 MB MELEBIHI batas 25 MiB/file Cloudflare Workers
   Static Assets (docs limits, 29 Okt 2026) — deploy akan gagal kalau
   ikut. Konsekuensinya: TIDAK ADA WebGPU di Sirna (jsep = runtime
   WebGPU ORT). Semua inferensi jalan di WASM multi-thread — lebih
   lambat untuk upscale, tapi deploy-able tanpa infra tambahan.
   Upgrade path (bukan sekarang): host jsep wasm di R2 publik + CORS
   dan arahkan wasmPaths ke sana, baru aktifkan WebGPU lagi.
   generateBundle: hapus aset wasm yang ikut ter-emit Vite karena ORT
   mereferensikannya via `new URL` di bundle worker (jsep 29,5 MB di
   dist/assets) — aset itu tidak pernah dipakai (wasmPaths = /ort/). */
function ortWasmPlugin() {
  return {
    name: "sirna-ort-wasm",
    configureServer(server: { middlewares: { use: (p: string, fn: (req: unknown, res: unknown, next: () => void) => void) => void } }) {
      server.middlewares.use("/ort/", (req, res, next) => {
        const r = req as { url?: string };
        const s = res as { setHeader: (k: string, v: string) => void; end: (b: Buffer) => void };
        const file = (r.url || "").split("?")[0].replace(/^\/+/, "");
        const p = join(ortDist, file);
        if (!file || file.includes("..") || !existsSync(p)) return next();
        s.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        s.end(readFileSync(p));
      });
    },
    generateBundle(_options: unknown, bundle: Record<string, { fileName?: string }>) {
      // Hapus aset wasm ORT yang ikut ter-emit Vite (lihat komentar di atas).
      for (const name of Object.keys(bundle)) {
        if (/^assets\/ort-wasm-.*\.wasm$/.test(name)) delete bundle[name];
      }
    },
    closeBundle() {
      const out = resolve("dist/ort");
      mkdirSync(out, { recursive: true });
      for (const f of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) {
        copyFileSync(join(ortDist, f), join(out, f));
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), ortWasmPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  publicDir: "public",
});
