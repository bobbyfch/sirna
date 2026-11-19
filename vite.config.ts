import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

/* Sirna — Vite + TypeScript + Tailwind v4. Output tetap file statis untuk
   Cloudflare Workers Static Assets (wrangler.jsonc: assets ./dist).
   base './' supaya hasil build tetap pakai path relatif seperti dulu —
   halaman bisa disajikan dari root domain tanpa asumsi base absolut.
   Pivot 19 Nov 2026: tanpa model, tanpa runtime AI — tidak ada lagi
   plugin ORT / dist/ort / unduhan model. */
export default defineConfig({
  base: "./",
  plugins: [tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  publicDir: "public",
});
