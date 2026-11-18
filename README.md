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

Buka `public/index.html` langsung di browser, atau sajikan sebagai situs statis:

```bash
npm run dev
# atau
python3 -m http.server public
```

## Deploy

Deploy mengikuti template `bobbyfch/cloudflare-starter`: **Cloudflare Workers
(Static Assets) + Workers Builds** — satu-satunya jalur deploy, bukan
Cloudflare Pages dan bukan GitHub Actions deploy.

- Repo GitHub: `bobbyfch/sirna`, branch produksi `main`
- Cloudflare Workers Builds: build command `npm run verify`, deploy command
  `npm run deploy:ci`, Node 24, preview builds off
- Domain: `sirna.limaraya.com` (custom domain di `wrangler.jsonc`, Worker
  name `sirna`)
- Build lokal: `npm run verify` (check → test → build `public/` ke `dist/` →
  guard aset → test dist). Deploy manual (bukan rutin): `npm run deploy:ci`.
- Rollback: revert commit di `main`, push, periksa build baru.

## Catatan teknis

- Satu file `public/index.html` (Tailwind via CDN, JSZip dimuat on-demand saat membuat ZIP)
- Aset gambar (logo generator di `public/assets/logos/`, maskot di `public/assets/`)
  disimpan terpisah karena bersifat biner
- Service worker `public/sw.js` didaftarkan di root domain agar scope PWA
  mencakup seluruh situs (salinan asli di `public/assets/sw.js` dipertahankan
  untuk artefak Muse). Manifest PWA di `public/assets/manifest.webmanifest`.
- CSP di `public/_headers` mengizinkan tepat dua origin eksternal yang dipakai
  halaman: Tailwind Play CDN dan cdnjs (JSZip)
