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

Buka `index.html` langsung di browser, atau sajikan sebagai situs statis:

```bash
npx serve .
# atau
python3 -m http.server
```

## Deploy

Situs statis. Deploy yang disarankan: **Cloudflare Pages** dari branch `main`,
domain `sirna.limaraya.com`. Tidak ada build step.

## Catatan teknis

- Satu file `index.html` (Tailwind via CDN, JSZip dimuat on-demand saat membuat ZIP)
- Aset gambar (logo generator di `assets/logos/`, maskot di `assets/`) disimpan
  terpisah karena bersifat biner
- Service worker `sw.js` harus berada di root domain agar scope PWA mencakup
  seluruh situs
