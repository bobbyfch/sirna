// Adaptasi Sirna dari tests/dist.test.mjs template bobbyfch/cloudflare-starter:
// - 'favicon.svg' dihapus dari daftar wajib: Sirna tidak punya favicon.svg
//   (favicon-nya inline data: SVG di index.html).
// - Pemeriksaan 'assets/site.css' diganti: Sirna tidak punya stylesheet
//   terpisah; yang diverifikasi adalah aset yang memang dipakai halaman —
//   sw.js root, manifest.webmanifest, dan satu logo.
// - 'sw.js' ditambahkan ke daftar wajib tingkat atas dist/ (service worker
//   root, scope seluruh situs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
const dir = new URL('../dist/', import.meta.url);
test('Production build exposes only public assets', async () => {
  const names=await readdir(dir);
  for(const name of ['index.html','404.html','_headers','robots.txt','assets','sw.js']) assert.ok(names.includes(name),`Missing ${name}`);
  for(const name of ['AGENTS.md','package.json','.env','scripts','node_modules','wrangler.jsonc']) assert.equal(names.includes(name),false,`Source accidentally published: ${name}`);
  assert.ok((await stat(new URL('assets/sw.js',dir))).size > 100);
  assert.ok((await stat(new URL('assets/manifest.webmanifest',dir))).size > 100);
  assert.ok((await stat(new URL('assets/logos/chatgpt.png',dir))).size > 100);
  assert.match(await readFile(new URL('index.html',dir),'utf8'),/<main/);
});
test('Hapus Objek: editor shell ada, SATU engine Mi-GAN, semua file di bawah batas deploy', async () => {
  const html = await readFile(new URL('index.html',dir),'utf8');
  assert.match(html, /Hapus Objek/);
  assert.match(html, /id="eraseModal"/);
  // Single-engine (19 Nov 2026): tidak ada lagi pilih mode AI
  // (Instan/Cepat/Terbaik), tapi bar progres unduhan model ADA —
  // model diunduh sekali saat alat dibuka, dengan Batalkan.
  assert.doesNotMatch(html, /data-erase-mode=/);
  assert.match(html, /id="eraseModelBar"/);
  assert.match(html, /id="eraseCancel"/);
  assert.match(html, /Batalkan/);
  assert.doesNotMatch(html, /Cepat AI|Terbaik|Instan/);
  assert.match(html, /Dihitung AI di HP kamu \(Mi-GAN, 28 MB/);
  // dist/ort ADA (bukan tidak ada): cuma 2 file WASM thread yang
  // dipakai — jsep/asyncify/jspi TIDAK boleh ada (jsep 29,5 MB dan
  // asyncify 28,7 MB lewat batas 25 MiB/file Cloudflare).
  const ortFiles = await readdir(new URL('ort',dir));
  assert.deepEqual(ortFiles.sort(), ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']);
  // Cloudflare Workers: file statis maks 25 MiB — nggak ada file dist yang boleh lewat.
  const LIMIT = 25 * 1024 * 1024;
  async function walk(u) {
    const out = [];
    for (const e of await readdir(u, { withFileTypes: true })) {
      const c = new URL(e.name, u.href.endsWith('/') ? u : new URL(u.href + '/'));
      if (e.isDirectory()) out.push(...await walk(c));
      else out.push(c);
    }
    return out;
  }
  for (const f of await walk(dir)) {
    const s = await stat(f);
    assert.ok(s.size <= LIMIT, `${f.pathname} = ${s.size} byte, lewat batas 25 MiB Cloudflare`);
  }
  // Single-engine: model HANYA di chunk worker + models (lazy).
  // Chunk utama TIDAK BOLEH membawa onnxruntime / host model / URL model.
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  const main = js.filter(n => /^index-/.test(n) || /^main-/.test(n));
  assert.ok(main.length >= 1, 'Missing main entry chunk');
  let mainBundle = '';
  for (const f of main) mainBundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.doesNotMatch(mainBundle, /onnxruntime|huggingface\.co|migan_pipeline|model_quantized|realesr-general/);
  // Worker chunk AI ADA dan membawa ORT (satu-satunya tempat ORT ada).
  const worker = js.filter(n => /^ai-worker-/.test(n));
  assert.ok(worker.length >= 1, 'Missing ai-worker chunk');
  let workerBundle = '';
  for (const f of worker) workerBundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.match(workerBundle, /InferenceSession/);
  // WASM-only ditegakkan di SUMBER worker (string "webgpu" tetap ada di
  // bundle ORT karena kode EP-nya ikut ter-bundle — yang penting tidak
  // pernah dipakai): executionProviders cuma ["wasm"].
  const workerSrc = await readFile(new URL('../src/ai-worker.ts', dir), 'utf8');
  assert.match(workerSrc, /executionProviders: \["wasm"\]/);
  assert.doesNotMatch(workerSrc, /executionProviders: \["webgpu"\]/);
  // Telea tetap ada sebagai fallback offline diam-diam (bukan mode).
  const eraseSrc = await readFile(new URL('../src/erase.ts', dir), 'utf8');
  assert.match(eraseSrc, /inpaintTelea/);
  assert.match(eraseSrc, /Mode offline/);
  assert.match(eraseSrc, /ensureEngine\("migan"/);
  assert.doesNotMatch(eraseSrc, /setMode|Cepat AI|Terbaik|lama_fp32/);
  const teleaSrc = await readFile(new URL('../src/telea.ts', dir), 'utf8');
  assert.match(teleaSrc, /GRAD_CLAMP = 8/); // clamp ±8 (hotfix zebra)
  const eraseChunk = js.filter(n => /^erase-/.test(n));
  assert.ok(eraseChunk.length >= 1, 'Missing erase chunk');
});
test('Hapus Watermark: kartu alat ada, deteksi lazy-load, model tetap di chunk erase', async () => {
  const html = await readFile(new URL('index.html',dir),'utf8');
  assert.match(html, /Hapus Watermark/);
  assert.match(html, /id="eraseTitle"/); // judul modal diatur pas dibuka (Objek / Watermark)
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  const main = js.filter(n => /^index-/.test(n) || /^main-/.test(n));
  assert.ok(main.length >= 1, 'Missing main entry chunk');
  let mainBundle = '';
  for (const f of main) mainBundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  // Detektor watermark tinggal di chunk lazy-nya sendiri (watermark-*),
  // bukan di chunk utama — buka halaman tidak ikut memuat logika deteksi.
  assert.doesNotMatch(mainBundle, /detectWatermark/);
  // Model TIDAK di chunk utama (cuma di worker + models, lazy).
  assert.doesNotMatch(mainBundle, /onnxruntime|huggingface\.co|migan_pipeline|model_quantized|realesr-general/);
  let all = '';
  for (const f of js) all += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.match(all, /detectWatermark/); // chunk watermark ada (lazy)
  const wm = js.filter(n => /^watermark-/.test(n));
  assert.ok(wm.length >= 1, 'Missing watermark chunk');
  let wmBundle = '';
  for (const f of wm) wmBundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.doesNotMatch(wmBundle, /onnxruntime|huggingface\.co/); // watermark murni deteksi — modelnya di chunk erase
});
test('Step 0: hotfix zebra + copy status', async () => {
  const html = await readFile(new URL('index.html',dir),'utf8');
  // Editor: strip langkah, peringatan mask besar, tombol "Urungkan hasil"
  // (ganti "Lanjut hapus"), Hapus mulai disabled sampai ada coretan.
  assert.match(html, /id="eraseSteps"/);
  assert.match(html, /id="eraseMaskWarn"/);
  assert.match(html, /id="eraseUndoResult"/);
  assert.match(html, /Urungkan hasil/);
  assert.match(html, /Bersihin coretan/);
  assert.match(html, /Tahan: lihat asli/);
  assert.match(html, /id="eraseRun"[^>]*disabled/);
  assert.doesNotMatch(html, /id="eraseMore"/); // "Lanjut hapus" dihapus
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  let bundle = '';
  for (const f of js) bundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  // Copy §4.3 (cepat): "Polos" -> "Tidak ada label", toast batch menutup
  // loop ("label AI sudah hilang"), toast "Mulai ulang." dihapus.
  assert.match(bundle, /Tidak ada label/);
  assert.match(bundle, /label AI sudah hilang/);
  assert.doesNotMatch(bundle, /Mulai ulang\./);
  assert.doesNotMatch(bundle, /Lanjut hapus/);
});
test('Step 1: state machine + copy §4.3 (satu sumber status)', async () => {
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  let bundle = '';
  for (const f of js) bundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  // Satu state machine: getFileState ada di SUMBER (identifier lokal
  // di-minify di bundle, jadi yang diasersi di bundle adalah literal
  // string pill yang cuma dihasilkan getFileState + PILL).
  const src = await readFile(new URL('../src/app.ts', dir), 'utf8');
  assert.match(src, /function getFileState\(item\)/);
  assert.match(src, /getFileState\(x\)\.key==="cleaned"/);
  assert.match(src, /getFileState\(i\)\.key==="cleaned"/);
  assert.match(bundle, /Lagi dibersihin…/);
  assert.match(bundle, /Sudah bersih/);
  // Copy §4.3: pill + kotak hasil + stats + aksi di kotak.
  assert.match(bundle, /Beres — sudah bersih/);
  assert.match(bundle, /Masih ada label/);
  assert.match(bundle, /Label AI ketemu/);
  assert.match(bundle, /0 label AI tersisa/);
  assert.match(bundle, /File ini aman diunggah/);
  assert.match(bundle, /file siap disimpan/);
  assert.match(bundle, /sudah bersih/);
  assert.match(bundle, /Coba Deep Clean/);
  assert.match(bundle, /File aslimu aman/);
  assert.match(bundle, /WebM hanya bisa dicek\. Pakai MP4 kalau mau dibersihkan\./);
  assert.match(bundle, /Label ketemu, tapi tidak bisa dibuang dari file ini\./);
  assert.match(bundle, /Lagi dibersihin…/);
  // Copy lama yang sudah diganti tidak boleh muncul lagi.
  assert.doesNotMatch(bundle, /"Bersih"/);
  assert.doesNotMatch(bundle, /Label tersisa/);
  assert.doesNotMatch(bundle, /Label AI ditemukan/);
  assert.doesNotMatch(bundle, /Dicek ulang: 0 label ·/);
  // Referensi mati #wf-clean-* / #wf-save-* sudah dibersihkan.
  assert.doesNotMatch(bundle, /wf-clean-|wf-save-/);
});
test('Step 2: pemilih alat + workspace per alat + stepper per alat', async () => {
  const html = await readFile(new URL('index.html',dir),'utf8');
  // Layar A: pemilih alat (7 kartu — semua alat model-free).
  assert.match(html, /id="toolPicker"/);
  assert.match(html, /data-tool="clean"/);
  assert.match(html, /data-tool="erase"/);
  assert.match(html, /data-tool="watermark"/);
  assert.match(html, /data-tool="background"/);
  assert.match(html, /data-tool="upscale"/);
  assert.match(html, /data-tool="jejak"/);
  assert.match(html, /data-tool="dedup"/);
  assert.match(html, /Foto &amp; video · otomatis/);
  assert.match(html, /Foto dulu · kuas/);
  assert.match(html, /Foto dulu · deteksi otomatis/);
  assert.match(html, /Latar apa pun jadi transparan/);
  assert.match(html, /Foto jadi 2× lebih besar/);
  assert.match(html, /Hapus GPS, EXIF &amp; data pribadi/);
  assert.match(html, /Cari foto yang sama\/mirip/);
  assert.match(html, /Pilih alat, taruh file, simpan/);
  // Stepper hero 5 langkah sudah dibunuh — tidak ada lagi di HTML.
  assert.doesNotMatch(html, /hero-steps/);
  assert.doesNotMatch(html, /Alur: deteksi, bersihkan, hapus objek/);
  // Layar B: workspace tersembunyi sampai alat dipilih; baris ganti alat
  // (chip wrap) + stepper per alat + pengaturan Bersihkan di dalam panel.
  assert.match(html, /<div class="tool-panel hidden" id="panel-cleaner">/);
  assert.match(html, /id="toolBar"/);
  assert.match(html, /data-tool-switch="clean"/);
  assert.match(html, /data-tool-switch="erase"/);
  assert.match(html, /data-tool-switch="watermark"/);
  assert.match(html, /data-tool-switch="background"/);
  assert.match(html, /data-tool-switch="upscale"/);
  assert.match(html, /data-tool-switch="jejak"/);
  assert.match(html, /data-tool-switch="dedup"/);
  assert.match(html, /Semua alat/);
  assert.match(html, /id="dedupView"/);
  assert.match(html, /id="dedupScanBtn"/);
  assert.match(html, /id="dedupGroups"/);
  assert.match(html, /id="toolStepper"/);
  assert.match(html, /id="settingsCard"/);
  // Router alat ada di sumber (identifier lokal di-minify di bundle).
  const src = await readFile(new URL('../src/app.ts', dir), 'utf8');
  assert.match(src, /var activeTool/);
  assert.match(src, /TOOL_STEPS/);
  assert.match(src, /function setActiveTool\(tool\)/);
  assert.match(src, /function updateToolStepper\(\)/);
  assert.match(src, /function routeFiles\(fileList\)/);
  // Label langkah tiap alat + toast antre ada di bundle.
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  let bundle = '';
  for (const f of js) bundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.match(bundle, /Pilih file/);
  assert.match(bundle, /Coret/);
  assert.match(bundle, /Deteksi/);
  assert.match(bundle, /file masuk — ketuk/);
});
test('Step 3: tumpukan versi + rel alat di kartu', async () => {
  const html = await readFile(new URL('index.html',dir),'utf8');
  // Tombol "Mulai dari file asli" di modal editor.
  assert.match(html, /id="eraseUseOriginal"/);
  assert.match(html, /Mulai dari file asli/);
  const src = await readFile(new URL('../src/app.ts', dir), 'utf8');
  assert.match(src, /item\.versions/);
  assert.match(src, /currentLabel/);
  assert.match(src, /function pushVersion\(item,label,blob,type,scan,box\)/);
  assert.match(src, /function setCurrentVersion\(item,label\)/);
  assert.match(src, /function renderVersions\(item\)/);
  assert.match(src, /function renderRail\(item\)/);
  assert.match(src, /function renderResultBox\(item,res,box\)/);
  assert.match(src, /data-act="version"/);
  assert.match(src, /"railclean"/); // segmen Bersihkan di rel (act dilewat sebagai argumen seg())
  assert.match(src, /showUseOriginal/);
  assert.match(src, /onUseOriginal/);
  // Editor meneruskan opsi "Mulai dari file asli" (erase + watermark).
  const eraseSrc = await readFile(new URL('../src/erase.ts', dir), 'utf8');
  assert.match(eraseSrc, /showUseOriginal/);
  assert.match(eraseSrc, /onUseOriginal/);
  const wmSrc = await readFile(new URL('../src/watermark.ts', dir), 'utf8');
  assert.match(wmSrc, /opts: EraseOptions/);
  // Copy C5–C6 di bundle.
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  let bundle = '';
  for (const f of js) bundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.match(bundle, /Versi:/);
  assert.match(bundle, /ketuk untuk kembali/);
  assert.match(bundle, /Kembali ke versi /);
  assert.match(bundle, /Versi yang lebih baru tetap tersimpan/);
  assert.match(bundle, /Bersihkan/);
});
test('Step 4: kejelasan editor (copy B1–B17) — SATU engine Mi-GAN, tanpa tier', async () => {
  const html = await readFile(new URL('index.html',dir),'utf8');
  // B5: deskripsi statis di HTML (satu engine: Mi-GAN, 28 MB, download sekali).
  assert.match(html, /Dihitung AI di HP kamu \(Mi-GAN, 28 MB — download sekali, tersimpan di HP\)\. Paling pas buat coretan kecil, teks, dan watermark\./);
  // Tidak ada lagi tier mode / bar model lama di HTML; bar progres ADA.
  assert.doesNotMatch(html, /data-erase-mode=/);
  assert.doesNotMatch(html, /Pakai Cepat AI/);
  assert.match(html, /id="eraseModelBar"/);
  assert.match(html, /id="eraseCancel"/);
  const eraseSrc = await readFile(new URL('../src/erase.ts', dir), 'utf8');
  // B1: subhead nyebut sumber gambar.
  assert.match(eraseSrc, /diedit dari /);
  assert.match(eraseSrc, /sourceLabel/);
  // Single-engine: Mi-GAN dipakai, Telea cuma fallback offline —
  // TIDAK ADA tier (setMode / Cepat AI / Terbaik / LaMa).
  assert.match(eraseSrc, /ensureEngine\("migan"/);
  assert.match(eraseSrc, /inpaintTelea/);
  assert.match(eraseSrc, /Mode offline/);
  assert.doesNotMatch(eraseSrc, /setMode|Cepat AI|Terbaik|lama_fp32|MODE_DESC/);
  assert.doesNotMatch(eraseSrc, /Download sekali 27 MB|Download sekali 198 MB/);
  // B17 baru: gagal hapus -> saran coretan lebih kecil; peringatan mask
  // besar -> bagi area (tanpa tawar mode AI).
  assert.match(eraseSrc, /Coba lagi dengan coretan lebih kecil/);
  assert.match(eraseSrc, /bagi jadi beberapa bagian kalau hasilnya kurang tajam/);
  // B2–B3: catatan deteksi watermark persis §4.3.
  const wmSrc = await readFile(new URL('../src/watermark.ts', dir), 'utf8');
  assert.match(wmSrc, /Ketemu[\s\S]*tanda di[\s\S]*periksa dulu, lalu tekan Hapus\./);
  assert.match(wmSrc, /Tidak ketemu tanda otomatis — coret manual bagian yang mau dihapus\./);
  // app.ts meneruskan label sumber ke editor.
  const appSrc = await readFile(new URL('../src/app.ts', dir), 'utf8');
  assert.match(appSrc, /SOURCE_LABEL/);
  assert.match(appSrc, /sourceLabel:/);
  assert.match(appSrc, /hasil Bersihkan/);
  // Copy bar model lama B10–B13 tidak boleh ada lagi di bundle mana pun.
  // ("Gagal unduh model" SAH muncul lagi — sekarang sebagai pesan error
  // jujur dari getModelBytes di src/models.ts, bukan copy bar mode.)
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  let bundle = '';
  for (const f of js) bundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.doesNotMatch(bundle, /Belum diunduh/);
  assert.doesNotMatch(bundle, /Tersimpan di HP ✓/);
  assert.doesNotMatch(bundle, /Mengunduh…/);
  assert.doesNotMatch(bundle, /Coba mode lain/);
});
test('Hapus Latar: SATU engine ORMBG int8, chroma-key DIHAPUS', async () => {
  const html = await readFile(new URL('index.html',dir),'utf8');
  assert.match(html, /Hapus Latar/);
  assert.match(html, /Latar apa pun bisa/);
  assert.match(html, /data-tool="background"/);
  assert.match(html, /data-tool-switch="background"/);
  assert.match(html, /id="bgModal"/);
  assert.match(html, /id="bgRun"/);
  assert.match(html, /checkerboard/); // preview transparan di atas papan catur
  // Chroma-key DIHAPUS: tidak ada lagi swatch/toleransi/mode kontigu.
  assert.doesNotMatch(html, /id="bgKeySwatch"/);
  assert.doesNotMatch(html, /id="bgKeyLabel"/);
  assert.doesNotMatch(html, /id="bgTol"/);
  assert.doesNotMatch(html, /data-bg-mode=/);
  assert.doesNotMatch(html, /Yang nyambung aja/);
  assert.doesNotMatch(html, /Hanya untuk foto berlatar polos/);
  assert.doesNotMatch(html, /Hapus Latar Polos/);
  // Bar progres model ADA (44 MB, sekali, + Batalkan).
  assert.match(html, /id="bgModelBar"/);
  assert.match(html, /id="bgCancel"/);
  assert.match(html, /Dihitung AI di HP kamu \(ORMBG, 44 MB/);
  // Wiring alat di sumber (identifier lokal di-minify di bundle).
  const appSrc = await readFile(new URL('../src/app.ts', dir), 'utf8');
  assert.match(appSrc, /background:\["Pilih file","Deteksi","Hapus","Simpan"\]/);
  assert.match(appSrc, /function openBackgroundFor\(item/);
  assert.match(appSrc, /"Latar"/);
  assert.match(appSrc, /seg\("background","Latar","background"\)/);
  assert.match(appSrc, /Hapus Latar/);
  const bgSrc = await readFile(new URL('../src/background.ts', dir), 'utf8');
  assert.match(bgSrc, /ensureEngine\("ormbg"/);
  assert.match(bgSrc, /function featherMask\(/); // post-pass wajib
  assert.match(bgSrc, /function upscaleMask\(/); // mask 1024 -> ukuran penuh
  assert.match(bgSrc, /blobToImageDataExact/); // ORMBG fixed-shape: input HARUS 1024x1024
  assert.match(bgSrc, /Latar dihapus ✓/);
  assert.doesNotMatch(bgSrc, /function keyAlpha\(|sampleCornerColor|despill|isnet|staticimgly/);
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  const main = js.filter(n => /^index-/.test(n) || /^main-/.test(n));
  assert.ok(main.length >= 1, 'Missing main entry chunk');
  let mainBundle = '';
  for (const f of main) mainBundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  // Model TIDAK di chunk utama (cuma di worker + models, lazy).
  assert.doesNotMatch(mainBundle, /onnxruntime|huggingface\.co|model_quantized/);
  const bg = js.filter(n => /^background-/.test(n));
  assert.ok(bg.length >= 1, 'Missing background chunk');
  // Copy jujur alat baru ada di bundle.
  let all = '';
  for (const f of js) all += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.match(all, /Latar dihapus ✓/);
  assert.match(all, /cek pinggir rambutnya/);
  // CSP single-engine (diasersi pada baris Content-Security-Policy-nya
  // saja, bukan komentar file): script-src mengizinkan 'wasm-unsafe-eval'
  // (WAJIB buat ORT — tanpa ini wasm gagal compile) tapi TIDAK
  // 'unsafe-eval' (eval JS tetap dilarang); connect-src mengizinkan
  // huggingface.co + CDN LFS-nya.
  const headers = await readFile(new URL('_headers', dir), 'utf8');
  const csp = (headers.match(/Content-Security-Policy: ([^\n]+)/) || [])[1] || '';
  assert.match(csp, /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';/);
  assert.doesNotMatch(csp, /'unsafe-eval'|staticimgly/);
  assert.match(csp, /connect-src 'self' https:\/\/huggingface\.co https:\/\/cdn-lfs\.huggingface\.co;/);
});
test('Perbesar + Hapus Jejak + Hapus Duplikat: modal & wiring, SATU engine Real-ESRGAN', async () => {
  const html = await readFile(new URL('index.html',dir),'utf8');
  // Modal Perbesar: seg skala 2x/3x, peringatan 3x, tombol bandingkan,
  // bar progres model + Batalkan.
  assert.match(html, /id="upModal"/);
  assert.match(html, /data-up-scale="2"/);
  assert.match(html, /data-up-scale="3"/);
  assert.match(html, /id="upWarn3"/);
  assert.match(html, /3× diproses dari 4× lalu diperkecil/);
  assert.match(html, /id="upRun"/);
  assert.match(html, /id="upCompare"/);
  assert.match(html, /Dihitung AI di HP kamu \(Real-ESRGAN x4v3, 4,6 MB/);
  assert.match(html, /id="upModelBar"/);
  assert.match(html, /id="upCancel"/);
  assert.doesNotMatch(html, /Memperbesar tanpa AI/);
  assert.doesNotMatch(html, /3× bisa terlihat lembut/);
  // Modal Hapus Jejak: daftar jejak + tombol hapus.
  assert.match(html, /id="jejakModal"/);
  assert.match(html, /id="jejakList"/);
  assert.match(html, /id="jejakRun"/);
  // Wiring di sumber.
  const appSrc = await readFile(new URL('../src/app.ts', dir), 'utf8');
  assert.match(appSrc, /upscale:\["Pilih file","Perbesar","Simpan"\]/);
  assert.match(appSrc, /jejak:\["Pilih file","Cari jejak","Hapus","Simpan"\]/);
  assert.match(appSrc, /dedup:\["Pilih file","Cari duplikat","Pilih yang disimpan","Selesai"\]/);
  assert.match(appSrc, /function openUpscaleFor\(item/);
  assert.match(appSrc, /function openJejakFor\(item/);
  assert.match(appSrc, /function scrubTracesBlob\(blob\)/);
  assert.match(appSrc, /function scanDuplicates\(\)/);
  assert.match(appSrc, /function removeDedupItems\(removeIds, keepIds\)/);
  assert.match(appSrc, /"Perbesar"/);
  assert.match(appSrc, /"Jejak"/);
  assert.match(appSrc, /seg\("upscale","Perbesar","upscale"\)/);
  assert.match(appSrc, /seg\("jejak","Jejak","jejak"\)/);
  assert.match(appSrc, /seg\("dedup","Duplikat","dedup"\)/);
  // Algoritma murni di sumber (bukan di bundle — nama di-minify).
  const lanczosSrc = await readFile(new URL('../src/lanczos.ts', dir), 'utf8');
  assert.match(lanczosSrc, /function lanczosUpscale\(img: ImageData, scale: Upscale\)/);
  assert.match(lanczosSrc, /function lanczosResample\(img: ImageData, newW: number, newH: number\)/); // 4x -> 3x di worker
  assert.match(lanczosSrc, /function lanczos\(x: number\)/);
  assert.match(lanczosSrc, /function unsharp\(img: ImageData/);
  const upSrc = await readFile(new URL('../src/upscale.ts', dir), 'utf8');
  assert.match(upSrc, /ensureEngine\("esrgan"/);
  assert.match(upSrc, /kind: "upscale"/);
  assert.match(upSrc, /Mode offline/); // Lanczos cuma fallback offline
  const jejakSrc = await readFile(new URL('../src/jejak.ts', dir), 'utf8');
  assert.match(jejakSrc, /function scanTraces\(blob: Blob\)/);
  assert.match(jejakSrc, /function parseExif\(/);
  assert.match(jejakSrc, /function filenameTrace\(/);
  const dedupSrc = await readFile(new URL('../src/dedup.ts', dir), 'utf8');
  assert.match(dedupSrc, /function phashImage\(blob: Blob\)/);
  assert.match(dedupSrc, /function hamming\(a: bigint, b: bigint\)/);
  assert.match(dedupSrc, /function groupDuplicates\(/);
  assert.match(dedupSrc, /function renderDedupGroups\(/);
  // Chunk lazy ada di dist; model TIDAK di chunk utama (cuma di worker
  // + models, lazy) — guard ini memeriksa SEMUA file JS untuk chunk
  // utama, dan worker chunk secara terpisah.
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  const main = js.filter(n => /^index-/.test(n) || /^main-/.test(n));
  let mainBundle = '';
  for (const f of main) mainBundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.doesNotMatch(mainBundle, /onnxruntime|huggingface\.co|realesr-general/);
  for (const prefix of ['upscale-', 'jejak-', 'dedup-', 'models-', 'ai-worker-']) {
    assert.ok(js.some(n => n.startsWith(prefix)), 'Missing ' + prefix + ' chunk');
  }
});
test('Single-engine: URL model ter-pin ke revisi HF + SHA-256 + SATU onnxruntime-web', async () => {
  // Registry di sumber: 3 URL resolve di-pin ke commit HF (bukan main),
  // 3 SHA-256 hex, 3 ukuran byte, 3 lisensi.
  const modelsSrc = await readFile(new URL('../src/models.ts', dir), 'utf8');
  assert.match(modelsSrc, /huggingface\.co\/andraniksargsyan\/migan\/resolve\/406830d0fa60666da0071c342ad2fbc8f30c5c64\/migan_pipeline_v2\.onnx/);
  assert.match(modelsSrc, /huggingface\.co\/onnx-community\/ormbg-ONNX\/resolve\/034e2d884afbab897e10e78fc5bb566b29533fd6\/onnx\/model_quantized\.onnx/);
  assert.match(modelsSrc, /huggingface\.co\/CoderViking\/realesr-general-x4v3-onnx\/resolve\/c6a971706797c7502945a2b4c4274fce4900d4ab\/realesr-general-x4v3\.onnx/);
  assert.match(modelsSrc, /6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b/); // Mi-GAN 28.079.181 B
  assert.match(modelsSrc, /ffbcae62a7b675d616e64cb392ee028786c4cf74f83596590fba13733ef00171/); // ORMBG 44.315.205 B
  assert.match(modelsSrc, /1940a93ee08283a0a7286183186357b1688fe9fa8ede74604b424586aaddf112/); // x4v3 4.866.417 B
  assert.match(modelsSrc, /28079181/);
  assert.match(modelsSrc, /44315205/);
  assert.match(modelsSrc, /4866417/);
  assert.doesNotMatch(modelsSrc, /\/resolve\/main\//); // TIDAK ADA fetch main tanpa pin
  assert.match(modelsSrc, /sirna-models-v2/); // Cache Storage sekali
  assert.match(modelsSrc, /crypto\.subtle\.digest\("SHA-256"/); // verifikasi SHA
  // SATU onnxruntime-web, exact 1.31.1, tanpa alias/dual-version.
  const pkg = JSON.parse(await readFile(new URL('../package.json', dir), 'utf8'));
  assert.equal(pkg.dependencies["onnxruntime-web"], "1.31.1");
  assert.equal(pkg.dependencies["ort121"], undefined);
  assert.doesNotMatch(JSON.stringify(pkg.dependencies), /onnxruntime-web@/); // tanpa alias npm:
  // URL ter-pin juga ada di chunk models yang di-bundle (lazy) — dan
  // TIDAK ADA URL main tanpa pin di bundle mana pun.
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  let all = '';
  for (const f of js) all += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.match(all, /406830d0fa60666da0071c342ad2fbc8f30c5c64/);
  assert.match(all, /034e2d884afbab897e10e78fc5bb566b29533fd6/);
  assert.match(all, /c6a971706797c7502945a2b4c4274fce4900d4ab/);
  assert.doesNotMatch(all, /huggingface\.co\/[^"'\s]*\/resolve\/main\//);
  // LaMa + ISNet + staticimgly sudah tidak ada di mana pun.
  assert.doesNotMatch(all, /lama_fp32|isnet|staticimgly|background-removal/);
  assert.doesNotMatch(modelsSrc, /lama_fp32|isnet|staticimgly/);
});
test('Vite build output: bundled JS/CSS, no CDN, preserved fixes', async () => {
  const html = await readFile(new URL('index.html',dir),'utf8');
  const assets = await readdir(new URL('assets',dir));
  const js = assets.filter(n => n.endsWith('.js'));
  const css = assets.filter(n => n.endsWith('.css'));
  assert.ok(js.length >= 1, 'Missing bundled JS');
  assert.ok(css.length >= 1, 'Missing bundled CSS');
  // Tailwind + JSZip dibundel: tidak ada lagi referensi CDN di output.
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com/);
  let bundle = '';
  for (const f of js) bundle += await readFile(new URL('assets/' + f, dir), 'utf8');
  assert.doesNotMatch(bundle, /cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com/);
  assert.match(bundle, /serviceWorker/);
  assert.match(bundle, /register\(["'`]sw\.js["'`]\)/); // esbuild minify bisa jadi template literal
  // Perilaku & fix Bobby yang harus selamat dari migrasi:
  assert.match(html, /© 2026 Bobby Fajar Christian · Bagian dari semesta limaraya\.com/);
  assert.match(html, /sosmed nggak lagi nganggep fotomu konten AI/);
  assert.doesNotMatch(bundle, /lavf|ffmpeg/); // 39bea0f: signature false positive dihapus
  // Identifier lokal di-minify esbuild, jadi yang diasersi adalah literal
  // string yang selamat dari minify dan membuktikan logikanya ada:
  assert.match(bundle, /Belum terverifikasi/); // getFileState jujur: Sudah bersih / Masih ada label / Belum terverifikasi (Langkah 1: "Label tersisa" -> "Masih ada label")
  assert.match(bundle, /Masih ada label/);
  assert.match(bundle, /tEXt/); // strip lossless Format=Asli (drop chunk tEXt/iTXt/zTXt/eXIf/jumb)
  assert.match(bundle, /`TB`,`PB`/); // formatBytes lengkap (B/KB/MB/GB/TB/PB)
});

test('Phase 2 layout (19 Nov 2026): picker dulu tanpa default + editor kanonis + tombol utama sticky', async () => {
  const html = await readFile(new URL('index.html',dir),'utf8');
  // Home universal: H1 bukan lagi "Hapus label AI" — label removal cuma
  // satu alat di antara yang lain (arah Bobby 08:49 WIB).
  assert.match(html, /<h1[^>]*>Taruh foto\. Beres\./);
  assert.doesNotMatch(html, /Hapus label AI/);
  assert.match(html, /Pilih alat, taruh file, simpan/);
  // Perbesar sekarang AI (Real-ESRGAN) — copy "tanpa AI" sudah salah.
  assert.match(html, /Foto dulu · AI/);
  assert.doesNotMatch(html, /tanpa AI/);
  // Coba foto contoh: tombol + banner staged (file diantre, alat tidak jalan).
  assert.match(html, /id="sampleBtn"/);
  assert.match(html, /Coba foto contoh/);
  assert.match(html, /id="sampleBanner"/);
  // Kepala editor kanonis: filmstrip + canvas + status + versi + undo/compare.
  assert.match(html, /id="editorHead"/);
  assert.match(html, /id="shellFilm"/);
  assert.match(html, /id="shellImg"/);
  assert.match(html, /id="shellVideo"/);
  assert.match(html, /id="shellPill"/);
  assert.match(html, /id="shellStatus"/);
  assert.match(html, /id="shellVersions"/);
  assert.match(html, /id="shellUndo"/);
  assert.match(html, /id="shellCompare"/);
  // Tombol utama sticky + tombol topbar (kembali / Export).
  assert.match(html, /id="primaryBar"/);
  assert.match(html, /id="primaryBtn"/);
  assert.match(html, /id="topBackBtn"/);
  assert.match(html, /id="topExportBtn"/);
  // Bottom sheet generik (konfirmasi destruktif).
  assert.match(html, /id="sheet"/);
  assert.match(html, /id="sheetScrim"/);
  assert.match(html, /id="sheetTitle"/);
  assert.match(html, /id="sheetConfirm"/);
  assert.match(html, /id="sheetCancel"/);
  // CSS: rail SATU baris scroll (bukan wrap) + fade + peek; canvas 55vh;
  // primary bar fixed; sheet fixed bawah.
  const css = await readFile(new URL('../src/style.css', dir), 'utf8');
  assert.match(css, /\.tool-bar\{display:flex;flex-wrap:nowrap/);
  assert.match(css, /\.tool-bar[^{]*\{[^}]*overflow-x:auto/);
  assert.match(css, /mask-image:linear-gradient\(90deg/);
  assert.match(css, /scroll-snap-type:x/);
  assert.match(css, /\.shell-canvas-wrap img[^{]*\{[^}]*max-height:55vh/);
  assert.match(css, /#primaryBar\{position:fixed/);
  assert.match(css, /#sheet\{position:fixed/);
  // Sumber: tidak ada alat default + tidak ada auto-pilih Bersihkan.
  const appSrc = await readFile(new URL('../src/app.ts', dir), 'utf8');
  assert.match(appSrc, /var activeTool=null/);
  assert.doesNotMatch(appSrc, /if\(!activeTool\) setActiveTool\(/);
  assert.match(appSrc, /TIDAK ADA alat default/);
  assert.match(appSrc, /Foto contoh dimuat/);
  assert.match(appSrc, /function syncShell\(\)/);
  assert.match(appSrc, /function syncPrimary\(\)/);
  assert.match(appSrc, /function runPrimary\(\)/);
  assert.match(appSrc, /function openSheet\(/);
  assert.match(appSrc, /function closeSheet\(\)/);
  assert.match(appSrc, /function removeItem\(/);
  assert.match(appSrc, /function selectItem\(/);
  assert.match(appSrc, /makeSampleFile/);
  assert.match(appSrc, /Bersihkan label/);
  assert.match(appSrc, /Simpan foto/);
  // Foto contoh digenerate runtime (tanpa biner di repo): canvas + injeksi
  // chunk tEXt PNG dengan CRC32, label OpenAI DALL·E.
  const sampleSrc = await readFile(new URL('../src/sample.ts', dir), 'utf8');
  assert.match(sampleSrc, /function crc32\(/);
  assert.match(sampleSrc, /function textChunk\(/);
  assert.match(sampleSrc, /function injectTextChunks\(/);
  assert.match(sampleSrc, /OpenAI DALL·E/);
  assert.match(sampleSrc, /export async function makeSampleFile/);
  // Kata kerja alat aktif ada semua di PRIMARY_VERB.
  assert.match(appSrc, /clean:"Bersihkan label",erase:"Hapus Objek",watermark:"Hapus Watermark",background:"Hapus Latar",upscale:"Perbesar",jejak:"Hapus Jejak",dedup:"Cari duplikat"/);
});
