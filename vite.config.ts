import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

/* Sirna — Vite + TypeScript + Tailwind v4. Output tetap file statis untuk
   Cloudflare Workers Static Assets (wrangler.jsonc: assets ./dist).
   base './' supaya hasil build tetap pakai path relatif seperti dulu —
   halaman bisa disajikan dari root domain tanpa asumsi base absolut.
   Model AI (nanti) JANGAN diimport statis di sini: muat per tool lewat
   dynamic import() supaya cuma diunduh pas tool-nya dibuka. */
export default defineConfig({
  base: "./",
  plugins: [tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  publicDir: "public",
});
