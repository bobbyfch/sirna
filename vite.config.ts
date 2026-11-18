import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { copyFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/* Sirna — Vite + TypeScript + Tailwind v4. Output tetap file statis untuk
   Cloudflare Workers Static Assets (wrangler.jsonc: assets ./dist).
   base './' supaya hasil build tetap pakai path relatif seperti dulu —
   halaman bisa disajikan dari root domain tanpa asumsi base absolut.
   Model AI JANGAN diimport statis di sini: muat per tool lewat
   dynamic import() supaya cuma diunduh pas tool-nya dibuka. */

/* onnxruntime-web (wasm EP) butuh 2 file runtime yang TIDAK ikut dibundel
   Vite: glue Emscripten (.mjs) + binary wasm-nya. Disalin ke
   dist/assets/ort/ pas build — dan di situlah src/erase.ts nunjuk
   ort.env.wasm.wasmPaths. Sengaja CUMA wasm EP: file WebGPU
   (ort-wasm-simd-threaded.jsep.wasm, 29,5 MB) melanggar batas 25 MiB
   per file Cloudflare Workers — jadi WebGPU tidak dipakai. */
function copyOrtWasm() {
  return {
    name: "sirna-copy-ort-wasm",
    writeBundle() {
      // createRequire().resolve() nggak bisa: package.json onnxruntime-web
      // nggak mengekspos subpath ./dist/*. Pakai path filesystem langsung.
      const dir = join(fileURLToPath(new URL(".", import.meta.url)), "node_modules", "onnxruntime-web", "dist");
      mkdirSync("dist/assets/ort", { recursive: true });
      for (const f of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) {
        copyFileSync(join(dir, f), "dist/assets/ort/" + f);
      }
      /* Vite ikut meng-emit salinan wasm ber-hash (dari new URL() di dalam
         bundle ort) ke dist/assets/. Runtime pakai salinan stabil di
         assets/ort/ (wasmPaths di src/erase.ts) — salinan ber-hash tidak
         pernah diminta, jadi dihapus biar dist nggak bawa 14,8 MB ganda. */
      for (const f of readdirSync("dist/assets")) {
        if (/^ort-wasm-simd-threaded-[A-Za-z0-9_-]+\.wasm$/.test(f)) unlinkSync(join("dist/assets", f));
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), copyOrtWasm()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  publicDir: "public",
});
