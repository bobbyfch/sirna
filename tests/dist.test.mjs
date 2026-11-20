// Pivot 19 Nov 2026 (DESIGN.md): Sirna tinggal 3 alat AI-related tanpa
// model — Bersihkan Label AI, Edit Metadata, Hapus Watermark AI — + history
// lokal (IndexedDB). File ini ditulis ulang dari 0 untuk pivot; tes lama
// yang mengasersi model (Mi-GAN/ORMBG/Real-ESRGAN, dist/ort, 7 alat,
// #queueSection, #dedupView, modal bg/up/jejak) sudah tidak berlaku dan
// dihapus bersama alatnya — bukan disembunyikan, melainkan diganti tes
// pivot di bawah.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
const dir = new URL('../dist/', import.meta.url);

async function allJs() {
  const assets = await readdir(new URL('assets', dir));
  const js = assets.filter(n => n.endsWith('.js'));
  let out = '';
  for (const f of js) out += await readFile(new URL('assets/' + f, dir), 'utf8');
  return { assets, js, out };
}
async function mainBundle() {
  const { js } = await allJs();
  const main = js.filter(n => /^index-/.test(n) || /^main-/.test(n));
  assert.ok(main.length >= 1, 'Missing main entry chunk');
  let out = '';
  for (const f of main) out += await readFile(new URL('assets/' + f, dir), 'utf8');
  return out;
}

test('Production build exposes only public assets', async () => {
  const names = await readdir(dir);
  for (const name of ['index.html', '404.html', '_headers', 'robots.txt', 'assets', 'sw.js']) assert.ok(names.includes(name), `Missing ${name}`);
  for (const name of ['AGENTS.md', 'package.json', '.env', 'scripts', 'node_modules', 'wrangler.jsonc']) assert.equal(names.includes(name), false, `Source accidentally published: ${name}`);
  assert.ok((await stat(new URL('assets/sw.js', dir))).size > 100);
  assert.ok((await stat(new URL('assets/manifest.webmanifest', dir))).size > 100);
  assert.ok((await stat(new URL('assets/logos/chatgpt.png', dir))).size > 100);
  assert.match(await readFile(new URL('index.html', dir), 'utf8'), /<main/);
  // Pivot: tidak ada lagi dist/ort (WASM ORT dicabut).
  assert.equal(names.includes('ort'), false, 'dist/ort must not exist after pivot');
});

test('File-first: dropzone di home, tanpa pemilih alat — rail 3 chip di editor', async () => {
  const html = await readFile(new URL('index.html', dir), 'utf8');
  // Home file-first: dropzone DI DALAM #heroSection & DI LUAR #panel-cleaner,
  // contoh tepat di bawah dropzone; TIDAK ADA lagi pemilih alat / tile.
  assert.match(html, /id="dropZone"/);
  assert.doesNotMatch(html, /id="toolPicker"/);
  assert.doesNotMatch(html, /data-tool="/);
  assert.ok(html.indexOf('id="dropZone"') > html.indexOf('id="heroSection"'), 'dropzone harus di dalam #heroSection');
  assert.ok(html.indexOf('id="dropZone"') < html.indexOf('id="panel-cleaner"'), 'dropzone harus di luar #panel-cleaner');
  assert.ok(html.indexOf('id="sampleRow"') > html.indexOf('id="dropZone"'), 'contoh harus di bawah dropzone');
  assert.match(html, /id="queueHint"/);
  assert.match(html, /id="resumeBtn"/);
  assert.match(html, /Buka editor/);
  // Nama alat kini hidup di chip rail editor (bukan tile): label chip.
  assert.match(html, />Bersihkan</);
  assert.match(html, /Edit Metadata/);
  assert.match(html, />Hapus Watermark</);
  // Copy tile lama hilang total dari HTML.
  assert.doesNotMatch(html, /Bersihkan Label AI/);
  assert.doesNotMatch(html, /Hapus Watermark AI/);
  assert.doesNotMatch(html, /Foto &amp; video · otomatis/);
  assert.doesNotMatch(html, /Hanya foto · deteksi otomatis/);
  assert.doesNotMatch(html, /id="sampleBanner"/);
  // Rail editor: 3 chip.
  assert.match(html, /id="toolBar"/);
  assert.match(html, /data-tool-switch="clean"/);
  assert.match(html, /data-tool-switch="meta"/);
  assert.match(html, /data-tool-switch="watermark"/);
  // Alat lama: tidak ada di HTML mana pun.
  for (const t of ['"erase"', '"background"', '"upscale"', '"jejak"', '"dedup"']) {
    assert.doesNotMatch(html, new RegExp('data-tool=' + t.replace(/"/g, '\\"')));
    assert.doesNotMatch(html, new RegExp('data-tool-switch=' + t.replace(/"/g, '\\"')));
  }
  assert.doesNotMatch(html, /Hapus Objek/);
  assert.doesNotMatch(html, /Hapus Latar/);
  assert.doesNotMatch(html, /Hapus Duplikat/);
  assert.doesNotMatch(html, /Hapus Jejak/);
  assert.doesNotMatch(html, /id="queueSection"/);
  assert.doesNotMatch(html, /id="dedupView"/);
  assert.doesNotMatch(html, /id="bgModal"/);
  assert.doesNotMatch(html, /id="upModal"/);
  assert.doesNotMatch(html, /id="jejakModal"/);
  assert.doesNotMatch(html, /id="eraseModelBar"/);
  assert.doesNotMatch(html, /id="eraseCancel"/);
  assert.doesNotMatch(html, /id="bgModelBar"/);
  assert.doesNotMatch(html, /id="upModelBar"/);
  assert.doesNotMatch(html, /Lagi unduh model/);
  // Sumber: tidak ada lagi open*For alat lama / scanDuplicates / renderItem.
  const appSrc = await readFile(new URL('../src/app.ts', dir), 'utf8');
  assert.doesNotMatch(appSrc, /function openEraserFor|function openBackgroundFor|function openUpscaleFor|function openJejakFor/);
  assert.doesNotMatch(appSrc, /function scanDuplicates|function removeDedupItems|function renderItem/);
  assert.doesNotMatch(appSrc, /TOOL_STEPS|RAIL_TOOLS/);
  assert.match(appSrc, /TOOL_RESULT_LABEL=\{clean:"Bersih",meta:"Metadata",watermark:"Watermark"\}/);
  assert.match(appSrc, /function openMetaFor\(/);
  assert.match(appSrc, /function openWatermarkFor\(/);
  assert.match(appSrc, /function autoRunTool\(tool, item\)/);
  assert.match(appSrc, /function updateToolStatus\(\)/);
});

test('Pivot: tanpa model — tidak ada onnx / host model / Telea di mana pun', async () => {
  const { out, js } = await allJs();
  assert.doesNotMatch(out, /onnxruntime|huggingface\.co|migan|ormbg|esrgan|Telea|inpaintTelea|Lagi unduh model/);
  assert.doesNotMatch(out, /sirna-models-v2/);
  // Chunk model/worker lama hilang; chunk watermark + sample tetap ada.
  assert.equal(js.some(n => n.startsWith('ai-worker-')), false, 'ai-worker chunk must be gone');
  assert.equal(js.some(n => n.startsWith('models-')), false, 'models chunk must be gone');
  assert.equal(js.some(n => n.startsWith('erase-')), false, 'erase chunk must be gone');
  assert.equal(js.some(n => n.startsWith('background-')), false, 'background chunk must be gone');
  assert.equal(js.some(n => n.startsWith('upscale-')), false, 'upscale chunk must be gone');
  assert.equal(js.some(n => n.startsWith('jejak-')), false, 'jejak chunk must be gone');
  assert.equal(js.some(n => n.startsWith('dedup-')), false, 'dedup chunk must be gone');
  assert.ok(js.some(n => n.startsWith('watermark-')), 'Missing watermark chunk');
  assert.ok(js.some(n => n.startsWith('sample-')), 'Missing sample chunk');
  // Sumber: file model sudah dicabut dari repo (bukan cuma tidak di-bundle).
  for (const f of ['src/models.ts', 'src/ai-worker.ts', 'src/background.ts', 'src/upscale.ts', 'src/dedup.ts', 'src/lanczos.ts', 'src/telea.ts', 'src/erase.ts', 'src/brush.ts']) {
    await assert.rejects(readFile(new URL('../' + f, dir), 'utf8'), f + ' must not exist');
  }
  const pkg = JSON.parse(await readFile(new URL('../package.json', dir), 'utf8'));
  assert.equal(pkg.dependencies['onnxruntime-web'], undefined, 'onnxruntime-web must be uninstalled');
  const headers = await readFile(new URL('_headers', dir), 'utf8');
  const csp = (headers.match(/Content-Security-Policy: ([^\n]+)/) || [])[1] || '';
  assert.match(csp, /script-src 'self' 'unsafe-inline';/);
  assert.doesNotMatch(csp, /wasm-unsafe-eval|'unsafe-eval'|huggingface/);
  assert.match(csp, /connect-src 'self';/);
});

test('Hapus Watermark v1: Gemini sparkle SAJA via reverse-alpha — tanpa brush, tanpa coret (keputusan Bobby 19 Nov 2026 17:24)', async () => {
  const html = await readFile(new URL('index.html', dir), 'utf8');
  assert.match(html, /Hapus Watermark/);
  // TIDAK ADA lagi modal kuas / tombol coret di v1.
  assert.doesNotMatch(html, /id="eraseModal"/);
  assert.doesNotMatch(html, /id="eraseRun"/);
  assert.doesNotMatch(html, /id="eraseSave"/);
  assert.doesNotMatch(html, /id="eraseTitle"/);
  assert.doesNotMatch(html, /id="eraseCanvas"/);
  assert.doesNotMatch(html, /id="eraseBrush"/);
  assert.doesNotMatch(html, /Hapus Objek/);
  assert.doesNotMatch(html, /Coret watermark/);
  assert.doesNotMatch(html, /Coret manual/);
  // brush.ts TIDAK PERNAH ADA (erase.ts dicabut penuh, bukan di-rename).
  for (const f of ['src/brush.ts', 'src/erase.ts']) {
    await assert.rejects(readFile(new URL('../' + f, dir), 'utf8'), f + ' must not exist');
  }
  const css = await readFile(new URL('../src/style.css', dir), 'utf8');
  assert.doesNotMatch(css, /\.erase-modal\{|#eraseCanvas\{/);
  // reverse-alpha di sumber: deteksi NCC + unblend, ambang 0.60.
  const revSrc = await readFile(new URL('../src/revalpha.ts', dir), 'utf8');
  assert.match(revSrc, /export function detectGeminiSparkle/);
  assert.match(revSrc, /export function removeSparkle/);
  assert.match(revSrc, /NCC_MIN = 0\.6/);
  assert.doesNotMatch(revSrc, /onnx|Telea|opencv|OpenCV/);
  // watermark.ts: SATU jalur removeWatermark (otomatis) + deteksi generik
  // HANYA untuk status jujur "bukan Gemini". Tanpa openBrush / fill / TBD.
  const wmSrc = await readFile(new URL('../src/watermark.ts', dir), 'utf8');
  assert.match(wmSrc, /export async function removeWatermark/);
  assert.match(wmSrc, /detectGeminiSparkle/);
  assert.match(wmSrc, /removeSparkle/);
  assert.match(wmSrc, /Tanda ketemu tapi bukan pola Gemini yang dikenal\./);
  assert.match(wmSrc, /Tidak ketemu tanda watermark di foto ini\./);
  assert.doesNotMatch(wmSrc, /openBrush|FILL_TBD|fill\?|Telea|inpaintTelea/);
  // app.ts: auto-run watermark tanpa editor; primary TIDAK menawarkan coret.
  const appSrc = await readFile(new URL('../src/app.ts', dir), 'utf8');
  assert.match(appSrc, /function openWatermarkFor\(item\)\{/);
  assert.match(appSrc, /removeWatermark/);
  assert.doesNotMatch(appSrc, /Coret watermark/);
  assert.doesNotMatch(appSrc, /openWatermark\(/);
  // Detektor tetap lazy di chunk watermark, bukan chunk utama. (Nama
  // `removeWatermark` WAJAR muncul di main sebagai property access
  // wm.removeWatermark() — yang tidak boleh ada di main adalah isi
  // deteksinya: NCC + alpha map + detectWatermark.)
  const main = await mainBundle();
  assert.doesNotMatch(main, /detectGeminiSparkle|detectWatermark|getAlphaMap|nccScore/);
  const { out } = await allJs();
  assert.match(out, /detectWatermark/);
  assert.match(out, /removeWatermark/);
  assert.doesNotMatch(out, /openBrush|FILL_TBD/);
});

test('Edit Metadata: modul baru + Hapus Jejak dilebur, jejak.ts jadi library', async () => {
  const html = await readFile(new URL('index.html', dir), 'utf8');
  assert.match(html, /id="metaPanel"/);
  const metaSrc = await readFile(new URL('../src/metaedit.ts', dir), 'utf8');
  assert.match(metaSrc, /export async function listEditableFields/);
  assert.match(metaSrc, /export async function applyFieldEdits/);
  assert.match(metaSrc, /export function wireMetaPanel/);
  assert.match(metaSrc, /Hapus jejak/);
  assert.match(metaSrc, /Terapkan perubahan/);
  assert.match(metaSrc, /Urungkan perubahan/);
  const jejakSrc = await readFile(new URL('../src/jejak.ts', dir), 'utf8');
  assert.match(jejakSrc, /function scanTraces\(blob: Blob\)/);
  assert.match(jejakSrc, /function parseExif\(/);
  assert.match(jejakSrc, /function filenameTrace\(/);
  assert.doesNotMatch(jejakSrc, /openJejak|JejakHooks/);
  const appSrc = await readFile(new URL('../src/app.ts', dir), 'utf8');
  assert.match(appSrc, /function openMetaFor\(/);
  assert.match(appSrc, /wireMetaPanel/);
});

test('History lokal: IndexedDB sirna-history, maks 20 FIFO, seksi Terakhir', async () => {
  const html = await readFile(new URL('index.html', dir), 'utf8');
  assert.match(html, /id="historySection"/);
  assert.match(html, /id="historyGrid"/);
  assert.match(html, /id="historyEmpty"/);
  assert.match(html, /id="historyClearBtn"/);
  assert.match(html, /Hanya di perangkat ini — tidak diunggah ke mana pun\./);
  assert.match(html, /History saya tersimpan di mana\?/);
  assert.match(html, /id="previewMeta"/);
  assert.match(html, /id="previewDownload"/);
  assert.match(html, /id="previewDelete"/);
  const histSrc = await readFile(new URL('../src/history.ts', dir), 'utf8');
  assert.match(histSrc, /sirna-history/);
  assert.match(histSrc, /HISTORY_MAX = 20/);
  assert.match(histSrc, /byCreated/);
  assert.match(histSrc, /byFileTool/);
  assert.match(histSrc, /export async function addHistory/);
  assert.match(histSrc, /export async function listHistory/);
  assert.match(histSrc, /export async function deleteHistory/);
  assert.match(histSrc, /export async function clearHistory/);
  assert.match(histSrc, /export async function makeThumb/);
  const appSrc = await readFile(new URL('../src/app.ts', dir), 'utf8');
  assert.match(appSrc, /function renderHistory\(\)/);
  assert.match(appSrc, /function recordHistory\(/);
  assert.match(appSrc, /function openHistoryPreview\(/);
  // History disembunyikan saat editor aktif (editor fullscreen = bukan home).
  assert.match(appSrc, /historySection/);
});

test('Bersihkan Label AI: logika scan/strip dipertahankan + copy §4.3', async () => {
  const { out } = await allJs();
  assert.match(out, /Tidak ada label/);
  assert.match(out, /label AI sudah hilang/);
  assert.match(out, /Beres — sudah bersih/);
  assert.match(out, /Masih ada label/);
  assert.match(out, /Label AI ketemu/);
  assert.match(out, /0 label AI tersisa/);
  assert.match(out, /Berkas berhasil diproses/);
  assert.match(out, /Bersihkan dengan Deep/);
  assert.doesNotMatch(out, /Coba Deep Clean/);
  assert.match(out, /File aslimu aman/);
  assert.match(out, /WebM hanya bisa dicek\. Pakai MP4 kalau mau dibersihkan\./);
  assert.match(out, /Label ketemu, tapi tidak bisa dibuang dari file ini\./);
  assert.match(out, /Lagi dibersihin…/);
  assert.match(out, /Sudah bersih/);
  assert.match(out, /Belum terverifikasi/);
  assert.match(out, /tEXt/);
  assert.match(out, /`TB`,`PB`/);
  // Copy lama yang sudah diganti tidak boleh muncul lagi.
  // "Bersih" SAH muncul lagi sebagai label versi alat Bersihkan
  // (TOOL_RESULT_LABEL) — bukan copy lama yang sudah diganti.
  assert.doesNotMatch(out, /Label tersisa/);
  assert.doesNotMatch(out, /Label AI ditemukan/);
  assert.doesNotMatch(out, /Mulai ulang\./);
  assert.doesNotMatch(out, /Lanjut hapus/);
  assert.doesNotMatch(out, /wf-clean-|wf-save-/);
  assert.doesNotMatch(out, /Belum diunduh/);
  assert.doesNotMatch(out, /Tersimpan di HP ✓/);
  assert.doesNotMatch(out, /Mengunduh…/);
  assert.doesNotMatch(out, /Coba mode lain/);
  // State machine satu sumber status masih ada di sumber.
  const appSrc = await readFile(new URL('../src/app.ts', dir), 'utf8');
  assert.match(appSrc, /function getFileState\(item\)/);
  assert.match(appSrc, /getFileState\(x\)\.key==="cleaned"/);
  assert.match(appSrc, /function renderResultBox\(item,res,box\)/);
  assert.match(appSrc, /function pushVersion\(item,label,blob,type,scan,box\)/);
  assert.match(appSrc, /function setCurrentVersion\(item,label\)/);
  assert.match(appSrc, /function renderVersions\(item\)/);
  assert.match(appSrc, /data-v="/); // chip versi (dulu data-act="version")
  assert.match(out, /Versi:/);
  assert.match(out, /Selesai bandingkan/);
  assert.match(out, /Kembali ke versi /);
  assert.match(out, /Versi yang lebih baru tetap tersimpan/);
});

test('Vite build output: bundled JS/CSS, no CDN, preserved fixes', async () => {
  const html = await readFile(new URL('index.html', dir), 'utf8');
  const assets = await readdir(new URL('assets', dir));
  const js = assets.filter(n => n.endsWith('.js'));
  const css = assets.filter(n => n.endsWith('.css'));
  assert.ok(js.length >= 1, 'Missing bundled JS');
  assert.ok(css.length >= 1, 'Missing bundled CSS');
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com/);
  const { out } = await allJs();
  assert.doesNotMatch(out, /cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com/);
  assert.match(out, /serviceWorker/);
  assert.match(out, /register\(["'`]sw\.js["'`]\)/);
  assert.match(html, /© 2026 Bobby Fajar Christian · Bagian dari semesta limaraya\.com/);
  assert.match(html, /Platform masih bisa mengenali konten AI/);
  assert.doesNotMatch(out, /lavf|ffmpeg/);
  // Cloudflare Workers: file statis maks 25 MiB.
  const LIMIT = 25 * 1024 * 1024;
  async function walk(u) {
    const o = [];
    for (const e of await readdir(u, { withFileTypes: true })) {
      const c = new URL(e.name, u.href.endsWith('/') ? u : new URL(u.href + '/'));
      if (e.isDirectory()) o.push(...await walk(c));
      else o.push(c);
    }
    return o;
  }
  for (const f of await walk(dir)) {
    const s = await stat(f);
    assert.ok(s.size <= LIMIT, `${f.pathname} = ${s.size} byte, lewat batas 25 MiB Cloudflare`);
  }
});

test('Phase 2 layout: file-first + editor kanonis + Simpan di top bar', async () => {
  const html = await readFile(new URL('index.html', dir), 'utf8');
  assert.match(html, /Lebih sedikit jejak/);
  assert.doesNotMatch(html, /Hapus label AI/);
  assert.match(html, /Periksa label AI dan metadata/);
  assert.doesNotMatch(html, /Pilih alat, taruh file, simpan/);
  assert.doesNotMatch(html, /tanpa AI/);
  assert.match(html, /id="sampleBtn"/);
  assert.match(html, /Coba foto contoh/);
  assert.match(html, /id="queueHint"/);
  assert.match(html, /id="resumeBtn"/);
  // Kepala editor kanonis: filmstrip + canvas + status + versi + compare.
  assert.match(html, /id="editorHead"/);
  assert.match(html, /id="shellFilm"/);
  assert.match(html, /id="shellImg"/);
  assert.match(html, /id="shellVideo"/);
  assert.match(html, /id="shellPill"/);
  assert.match(html, /id="shellStatus"/);
  assert.match(html, /id="shellVersions"/);
  assert.doesNotMatch(html, /id="shellUndo"/);
  assert.match(html, /id="shellCompare"/);
  assert.match(html, /Bandingkan/);
  // Baris aksi file di bawah kanvas (baru pivot): Buang file + Mulai ulang.
  assert.match(html, /id="removeFileBtn"/);
  assert.match(html, /Buang file ini/);
  assert.match(html, /id="restartBtn"/);
  assert.match(html, /Mulai ulang/);
  // SATU tombol Unduh di dekat hasil (mobile sticky), topbar fokus navigasi.
  assert.match(html, /id="editorTopBar"/);
  assert.match(html, /id="primaryBtn"/);
  assert.match(html, /id="editorBackBtn"/);
  assert.doesNotMatch(html, /id="primaryBar"/);
  assert.doesNotMatch(html, /id="topBackBtn"/);
  assert.doesNotMatch(html, /id="topExportBtn"/);
  // Bottom sheet generik (konfirmasi destruktif) + tombol extra (guard draft meta).
  assert.match(html, /id="sheet"/);
  assert.match(html, /id="sheetScrim"/);
  assert.match(html, /id="sheetTitle"/);
  assert.match(html, /id="sheetConfirm"/);
  assert.match(html, /id="sheetCancel"/);
  assert.match(html, /id="sheetExtra"/);
  // CSS: rail SATU baris scroll (bukan wrap) + fade + peek; canvas 55vh;
  // top bar editor sticky; sheet fixed bawah; header situs hilang saat editor.
  const css = await readFile(new URL('../src/style.css', dir), 'utf8');
  assert.match(css, /\.tool-bar\{display:flex;flex-wrap:nowrap/);
  assert.match(css, /\.tool-bar[^{]*\{[^}]*overflow-x:auto/);
  assert.match(css, /mask-image:linear-gradient\(90deg/);
  assert.match(css, /scroll-snap-type:x/);
  assert.match(css, /\.shell-canvas-wrap img[^{]*\{[^}]*max-height:55vh/);
  assert.match(css, /\.editor-topbar\{position:sticky/);
  assert.match(css, /body\.editor-on header\{display:none/);
  assert.doesNotMatch(css, /#primaryBar\{/);
  assert.match(css, /#sheet\{position:fixed/);
  // Kelas baru pivot ada di CSS; kelas alat lama sudah disapu.
  assert.match(css, /\.history-grid\{/);
  assert.match(css, /\.history-card\{/);
  assert.match(css, /\.meta-panel\{/);
  assert.match(css, /\.meta-row\{/);
  // Perbaikan §(e) WORKFLOW-REDESIGN.md: top bar solid opaque, bubble
  // mascot di atas, stage 96px, padding cadangan editor, tanpa class tile.
  assert.match(css, /\.editor-topbar\{[^}]*background:var\(--surface\)/);
  assert.doesNotMatch(css, /\.editor-topbar\{[^}]*backdrop-filter/);
  assert.match(css, /\.mascot-bubble\{[^}]*bottom:calc\(100% \+ 10px\)/);
  assert.match(css, /\.mascot-bubble\{[^}]*max-width:200px/);
  assert.match(css, /#mascotStage\{[^}]*bottom:calc\(96px/);
  assert.match(css, /body\.editor-on main\{padding-bottom:calc\(120px/);
  assert.match(css, /#queueHint\{/);
  assert.match(css, /#resumeBtn\{/);
  assert.doesNotMatch(css, /\.tool-picker\{|\.tool-card\{/);
  assert.doesNotMatch(css, /\.dedup-group\{/);
  assert.doesNotMatch(css, /\.ai-progress\{/);
  assert.doesNotMatch(css, /\.card-progress\{/);
  // Sumber: alat default = Bersihkan saat file masuk dari home (file-first);
  // tidak ada lagi state "file menunggu alat dipilih".
  const appSrc = await readFile(new URL('../src/app.ts', dir), 'utf8');
  assert.match(appSrc, /var activeTool=null/);
  assert.match(appSrc, /var lastTool=null/);
  assert.match(appSrc, /if\(!activeTool\) setActiveTool\("clean"\)/);
  assert.match(appSrc, /Default = "clean"/);
  assert.match(appSrc, /lastTool \|\| "clean"/);
  assert.match(appSrc, /queueHint/);
  assert.match(appSrc, /resumeBtn/);
  assert.doesNotMatch(appSrc, /pilih alat/);
  assert.doesNotMatch(appSrc, /toolPicker|sampleBanner/);
  assert.match(appSrc, /function ensureSampleThumb/);
  assert.match(appSrc, /function syncShell\(\)/);
  assert.match(appSrc, /function syncPrimary\(\)/);
  assert.match(appSrc, /function runPrimary\(\)/);
  assert.match(appSrc, /function openSheet\(/);
  assert.match(appSrc, /function closeSheet\(\)/);
  assert.match(appSrc, /function removeItem\(/);
  assert.match(appSrc, /function selectItem\(id\)\{\n  selectedId=id; shellComparing=false; clearShellResult\(\); syncShell\(\); syncPrimary\(\); updateStats\(\);/);
  // Kotak hasil basi: selectItem / openMetaFor / clearAllItems (Mulai ulang)
  // harus membersihkan #shellResult (hidden + kosong), bukan menampilkannya lagi.
  assert.match(appSrc, /function clearShellResult\(\)\{ var r=document\.getElementById\("shellResult"\); if\(r\)\{ r\.classList\.add\("hidden"\); r\.innerHTML=""; \} \}/);
  assert.match(appSrc, /async function openMetaFor\(item\)\{\n  clearShellResult\(\);/);
  assert.match(appSrc, /function clearAllItems\(\)\{\n  clearShellResult\(\);/);
  assert.match(appSrc, /makeSampleFile/);
  assert.match(appSrc, /Unduh hasil/);
  assert.match(appSrc, /Unduh semua/);
  assert.match(appSrc, /function autoRunTool\(tool, item\)/);
  assert.match(appSrc, /function updateToolStatus\(\)/);
  // Foto-only: video terpilih dengan alat meta/watermark -> status jujur,
  // tombol utama tidak tampil (bukan crash).
  assert.match(appSrc, /var hasOutput=!!\(activeTool && it && it\.cleanedBlob && it\.currentLabel!=="Asli"\)/);
  assert.match(appSrc, /Video dipilih — /);
  // Foto contoh digenerate runtime (tanpa biner di repo): canvas + injeksi
  // chunk tEXt PNG dengan CRC32, label OpenAI DALL·E.
  const sampleSrc = await readFile(new URL('../src/sample.ts', dir), 'utf8');
  assert.match(sampleSrc, /function crc32\(/);
  assert.match(sampleSrc, /function textChunk\(/);
  assert.match(sampleSrc, /function injectTextChunks\(/);
  assert.match(sampleSrc, /OpenAI DALL·E/);
  assert.match(sampleSrc, /export async function makeSampleFile/);
});
