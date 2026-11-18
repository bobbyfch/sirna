# Sirna

Hapus label AI dari foto & video — 100% lokal di browser.

Taruh file. Beres. Simpan.

Sirna memindai dan membersihkan label/metadata AI (C2PA / Content Credentials,
EXIF, XMP, IPTC, chunk teks PNG berisi prompt/seed) dari foto dan video hasil
generator AI seperti ChatGPT/DALL·E, Gemini/Imagen, Midjourney, Stable Diffusion,
Adobe Firefly, Meta AI, Leonardo, Ideogram, FLUX, Sora, Veo, Runway, Kling, dan
lainnya. File tidak pernah diunggah — semua proses berjalan di perangkatmu.

> Jujur soal batas: watermark yang tertanam di piksel (mis. SynthID) tidak
> dijamin hilang hanya dengan membersihkan metadata.

## Fitur

- **Deteksi** — memindai label AI dan menampilkan sumbernya (mis. ChatGPT, Gemini)
- **Bersihkan** — menghapus metadata AI, sekali file atau batch
- **Metadata** — melihat & menghapus EXIF (termasuk peringatan lokasi GPS)
- **Konversi** — JPG / PNG / WebP
- **Video** — memindai & membersihkan MP4/MOV tanpa re-encode (WebM hanya dipindai)
- **PWA** — bisa dipasang sebagai shortcut di HP
- **100% lokal** — foto/videomu tidak pernah keluar dari perangkat

## Menjalankan

```bash
npm install
npm run dev      # Vite dev server (HMR)
npm run build    # Vite build -> dist/
npm run verify   # check + typecheck + test + build + guard aset + test dist
npm run preview  # sajikan hasil build lokal
```

## Struktur

- `index.html` — entry Vite (root). Script tema inline di head (jalan sebelum
  render biar nggak kedip), lalu `<script type="module" src="/src/main.ts">`
  di akhir body.
- `src/` — TypeScript (tanpa framework JS):
  - `main.ts` — entry, urutan eksekusi dipertahankan (app → mascot → pwa → marquee)
  - `app.ts` — deteksi / bersih / metadata / konversi / video + pengaturan
  - `mascot.ts` — gerak 3D + maskot Naya (pendamping proses)
  - `pwa.ts` — daftar service worker + tombol "Pasang Sirna di HP"
  - `marquee.ts` — pause marquee logo pas di luar layar
  - `style.css` — Tailwind v4 (`@import "tailwindcss"`, `@theme`, `@custom-variant dark`)
    + seluruh CSS kustom (dulu 10 blok `<style>`) dalam `@layer components`
- `public/` — aset statis yang disalin verbatim ke `dist/`: `404.html`,
  `_headers`, `robots.txt`, `sw.js` (root scope), `assets/` (logo generator,
  maskot, ikon PWA, manifest)
- `dist/` — hasil build. Jangan diedit; di-regenerate tiap `npm run build`.
- `scripts/` — check / predeploy / guard / setup dari template Cloudflare
- `tests/` — node:test (config, setup, guard, dist)

## Deploy

Deploy mengikuti template `bobbyfch/cloudflare-starter`: **Cloudflare Workers
(Static Assets) + Workers Builds** — satu-satunya jalur deploy, bukan
Cloudflare Pages dan bukan GitHub Actions deploy.

- Repo GitHub: `bobbyfch/sirna`, branch produksi `main`
- Cloudflare Workers Builds: build command `npm run verify`, deploy command
  `npm run deploy:ci`, Node 24, preview builds off
- Domain: `sirna.limaraya.com` (custom domain di `wrangler.jsonc`, Worker
  name `sirna`)
- Build lokal: `npm run verify` (check → typecheck → test → build Vite ke
  `dist/` → guard aset → test dist). Deploy manual (bukan rutin):
  `npm run deploy:ci`.
- Rollback: revert commit di `main`, push, periksa build baru.

## Catatan teknis

- Vite 8 + TypeScript 7 + Tailwind v4 (`@tailwindcss/vite`), tanpa framework
  JS. Utilitas Tailwind dipakai di HTML + template string TS — semuanya
  literal, jadi terdeteksi scanner Tailwind v4. `dark:` memakai
  `@custom-variant dark` (class-based, seperti `darkMode: 'class'` dulu).
- CSS kustom ada di `@layer components` supaya utilitas Tailwind tetap menang
  saat seri — sama seperti dulu ketika Play CDN menyuntikkan `<style>`-nya di
  akhir `<head>`.
- JSZip (npm, di-pin 3.10.1) dimuat malas via dynamic `import()` — chunk
  terpisah, baru diunduh pas user neken tombol ZIP. Pola yang sama berlaku
  buat model AI nanti (onnxruntime-web dsb.): JANGAN diimport statis — muat
  per tool saat tool-nya dibuka, tampilkan progress, cache setelahnya.
  Beban awal Sirna harus tetap ringan.
- Service worker `public/sw.js` (cache `sirna-v3`) didaftarkan di root domain
  agar scope PWA mencakup seluruh situs (salinan asli di
  `public/assets/sw.js` dipertahankan untuk artefak Muse). Daftar precache
  hanya berisi file yang memang ada di `dist/` (logo, maskot, ikon, manifest);
  bundle JS/CSS hasil Vite di-cache runtime oleh fetch handler. Manifest PWA
  di `public/assets/manifest.webmanifest`.
- CSP di `public/_headers` tidak lagi mengizinkan origin eksternal (Tailwind
  + JSZip sudah dibundel); `'unsafe-inline'` masih perlu buat script tema
  inline + atribut `style`.
