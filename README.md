# Sirna

Hapus label AI dari foto & video — 100% lokal di browser.

Taruh file. Beres. Simpan.

**Alur (file-first, 19 Nov 2026):** taruh foto atau video dulu — drop, pilih,
paste, atau foto contoh — dari home; editor langsung terbuka dan Bersihkan
Label AI jalan otomatis (tanpa pilih alat dulu). Ganti alat lewat 3 chip di
rail editor (Edit Metadata / Hapus Watermark AI) tanpa upload ulang; kembali
ke home dengan ‹ Back, lalu masuk lagi lewat "Buka editor" (antrean, hasil
& versi tetap utuh) atau tombol "+ File" di header. Meta & watermark bekerja
pada blob versi terpilih (biasanya "Bersih"); chip versi "Asli" adalah jalan
kembali ke file asli.

Sirna memindai dan membersihkan label/metadata AI (C2PA / Content Credentials,
EXIF, XMP, IPTC, chunk teks PNG berisi prompt/seed) dari foto dan video hasil
generator AI seperti ChatGPT/DALL·E, Gemini/Imagen, Midjourney, Stable Diffusion,
Adobe Firefly, Meta AI, Leonardo, Ideogram, FLUX, Sora, Veo, Runway, Kling, dan
lainnya. File tidak pernah diunggah — semua proses berjalan di perangkatmu.

> Jujur soal batas: watermark yang tertanam di piksel (mis. SynthID) tidak
> dijamin hilang hanya dengan membersihkan metadata.

## Fitur (pivot 19 Nov 2026 — 3 alat, tanpa model)

- **Bersihkan Label AI** — memindai & menghapus label/metadata AI (C2PA / Content Credentials, EXIF, XMP, IPTC, chunk teks PNG berisi prompt/seed), sekali file atau batch; hasil dicek ulang (re-scan 0 label)
- **Edit Metadata** — melihat, mengubah & menghapus field metadata foto (EXIF, PNG text, XMP/IPTC, GPS); "Hapus jejak" menghapus GPS/EXIF/IPTC/XMP/teks PNG & profil ICC sekali ketuk
- **Hapus Watermark AI** — v1 = sparkle Gemini saja via reverse-alpha blending (port repo MIT GargantuaX/gemini-watermark-remover — lihat `src/revalpha.ts`); tanda lain → status jujur, tanpa coret manual (keputusan Bobby 19 Nov 2026 17:24 WIB)
- **Terakhir (history lokal)** — hasil bersih tersimpan otomatis di IndexedDB perangkat (maks 20, FIFO, foto saja); buka lagi, unduh ulang, atau hapus — tidak pernah diunggah
- **Video** — Bersihkan memindai & membersihkan MP4/MOV tanpa re-encode (WebM hanya dipindai); Edit Metadata & Hapus Watermark hanya untuk foto
- **PWA** — bisa dipasang sebagai shortcut di HP
- **100% lokal** — foto/videomu tidak pernah keluar dari perangkat; tanpa model, tanpa server, tanpa akun

## Antarmuka editor (20 Nov 2026)

- File-first: pilih file atau contoh; Sirna memproses otomatis dan membuka editor.
- Desktop menempatkan preview dan versi di kiri serta pilihan alat, hasil, tombol **Unduh hasil**, dan pengaturan di kanan. Tablet dan telepon mengikuti satu kolom; di telepon tombol unduh menempel di bawah dengan safe area.
- Pilihan versi **Asli / Bersih / Metadata / Watermark** mengubah versi aktif. Saat **Asli** aktif, tombol unduh hasil disembunyikan sampai versi hasil dipilih kembali.
- Mengubah format atau kualitas memunculkan **Terapkan perubahan**; hasil diolah ulang sebelum bisa diunduh. Mengubah nama file hanya memengaruhi nama unduhan.
- Header editor menampilkan Kembali, Terakhir, mode terang/gelap, dan Tambah File. Pada HP, editor juga menyediakan pilihan khusus menambahkan video dari galeri. Pemeriksaan teknis dan Content Credentials ada di rincian yang bisa dibuka.
- Pratinjau selalu mencantumkan nama file dan posisi antrean. **Bandingkan** menampilkan foto asli sementara tanpa mengubah versi file yang akan diunduh; pemilihan versi tetap lewat chip Asli / Bersih / Metadata / Watermark.
- Edit Metadata melindungi perubahan yang belum diterapkan ketika berpindah file, kembali, atau membuka riwayat; pengguna bisa menerapkan, membuang draf, atau membatalkan.
- **Unduh hasil** berarti download file lokal, bukan share-sheet. Untuk batch, beberapa hasil diunduh sebagai satu ZIP. Riwayat tersimpan otomatis secara lokal dan terpisah dari aksi download.
- Jalankan `npm run verify` untuk pengujian build. `npm run build && npm run test:responsive` menyediakan pemeriksaan viewport tambahan jika Chromium Playwright tersedia secara lokal.

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
  - `app.ts` — antrean file + 3 alat + history + pengaturan
  - `history.ts` — history lokal IndexedDB (maks 20, FIFO, foto saja)
  - `metaedit.ts` — Edit Metadata: daftar field, edit in-place, hapus field, panel
  - `revalpha.ts` — reverse-alpha sparkle Gemini (port MIT, data alpha map repo)

  - `watermark.ts` — deteksi tanda pojok/tepi + sambungan reverse-alpha
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
  terpisah, baru diunduh pas user neken tombol ZIP. Beban awal Sirna harus
  tetap ringan. Tanpa model AI: tidak ada runtime/model yang diunduh.
- Service worker `public/sw.js` (cache `sirna-v3`) didaftarkan di root domain
  agar scope PWA mencakup seluruh situs (salinan asli di
  `public/assets/sw.js` dipertahankan untuk artefak Muse). Daftar precache
  hanya berisi file yang memang ada di `dist/` (logo, maskot, ikon, manifest);
  bundle JS/CSS hasil Vite di-cache runtime oleh fetch handler. Manifest PWA
  di `public/assets/manifest.webmanifest`.
- CSP di `public/_headers` tidak lagi mengizinkan origin eksternal (Tailwind
  + JSZip sudah dibundel); `'unsafe-inline'` masih perlu buat script tema
  inline + atribut `style`.

## Studio 2026 — antarmuka dan pemeriksaan lokal

- Beranda sederhana: masukkan satu atau banyak file → proses otomatis → lihat hasil dan simpan.
- Inspector: format/resolusi/metadata yang dikenali, ringkasan jejak privasi, dan indikasi *wadah* C2PA secara lokal. **Tidak melakukan verifikasi sertifikat, signature, manifest, maupun provenance eksternal**; tidak adanya penanda bukan bukti bahwa konten bukan AI.
- Tiga profil cleaning: Label & Metadata, Privasi Menyeluruh, Deep Clean. Proses ulang antrean ketika profil berubah. Deep dapat mengubah kualitas atau piksel gambar.
- Setelah memproses: perbandingan ukuran, resolusi jika browser bisa decode, format, dan jumlah jejak yang masih terdeteksi. Pernyataan lossless dibuat hanya pada jalur yang memang menghapus chunk tanpa menggambar ulang.
- Batch: antrean, hentikan setelah berkas aktif selesai, ulangi berkas gagal, dan unduh beberapa hasil sebagai ZIP.
- Template metadata: simpan **aturan menghapus field saja** di penyimpanan lokal; preview dan terapkan secara eksplisit. Nilai EXIF/GPS tidak disimpan ke template.
- HEIC/HEIF/TIFF dapat dipilih dan dicoba didekode oleh browser; **tidak semua browser mendukungnya**. Jika decode gagal, tampilkan alasan agar pengguna mengekspor dari galeri ke JPG/PNG dulu. Hindari mengganti format secara diam-diam.
- Semua pemrosesan tetap browser-only, tanpa unggahan berkas ke backend. Pemindaian inspector menggunakan module Web Worker jika tersedia, dengan fallback pada browser yang tidak mendukungnya.

UI mengikuti kontrak Apple-first pada AGENTS.md untuk hierarki, keterjangkauan sentuh, fokus keyboard, dark mode, reduced motion/transparency, dan progressive disclosure. Layer glass dipakai terbatas pada navigasi, bukan pada isi berkas.

**Catatan:** menghapus metadata tertanam tidak menjamin aplikasi sosial tidak mengenali gambar AI; jejak asal-usul juga bisa berada di sistem eksternal.
