// Unit test Edit Metadata (src/metaedit.ts) — Node, tanpa DOM.
// JPEG EXIF Make/Model/GPS -> hapus GPS -> re-parse GPS hilang, field
// lain utuh; edit Make in-place; PNG tEXt edit + hapus -> CRC valid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { listPngChunks, decodePng } from './fixtures/png-io.mjs';

spawnSync('./node_modules/.bin/tsc', ['src/metaedit.ts', 'src/jejak.ts', '--ignoreConfig', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', '--outDir', '/tmp/meta-ts-out', '--skipLibCheck'], { cwd: '/home/hatch/workspace/sirna-vite' });
// tsc nodenext mempertahankan import "./jejak" tanpa ekstensi — tambahkan .js agar Node bisa resolve.
import { writeFileSync } from 'node:fs';
{
  const p = '/tmp/meta-ts-out/metaedit.js';
  writeFileSync(p, readFileSync(p, 'utf8').replace('from "./jejak"', 'from "./jejak.js"'));
}
const { listEditableFields, applyFieldEdits } = await import('/tmp/meta-ts-out/metaedit.js');
const { scanTraces } = await import('/tmp/meta-ts-out/jejak.js');

const jpgBuf = () => readFileSync(new URL('./fixtures/jejak-exif.jpg', import.meta.url));
const jpgBlob = () => new Blob([jpgBuf()], { type: 'image/jpeg' });

test('JPEG: daftar field berisi Make/Model/GPS', async () => {
  const fields = await listEditableFields(jpgBlob(), 'jejak-exif.jpg', Date.now());
  const byLabel = new Map(fields.map(f => [f.label, f]));
  assert.match(byLabel.get('Make (kamera)')?.value || '', /Canon/);
  assert.match(byLabel.get('Model')?.value || '', /EOS R50/);
  const gps = fields.find(f => f.kind === 'exif-gps');
  assert.ok(gps, 'field GPS harus ada');
  assert.equal(gps.deletable, true);
  assert.equal(gps.editable, false);
});

test('JPEG: edit Make in-place (muat) -> Model + GPS utuh', async () => {
  const fields = await listEditableFields(jpgBlob(), 'jejak-exif.jpg', Date.now());
  const make = fields.find(f => f.label === 'Make (kamera)');
  const { blob, skipped } = await applyFieldEdits(jpgBlob(), [{ id: make.id, action: 'edit', value: 'Nikon' }], fields);
  assert.deepEqual(skipped, []);
  const after = await listEditableFields(blob, 'jejak-exif.jpg', Date.now());
  const byLabel = new Map(after.map(f => [f.label, f]));
  assert.equal(byLabel.get('Make (kamera)')?.value, 'Nikon');
  assert.match(byLabel.get('Model')?.value || '', /EOS R50/);
  assert.ok(after.find(f => f.kind === 'exif-gps'), 'GPS harus tetap ada');
  // File tetap JPEG valid: masih bisa di-scan jejaknya.
  const traces = await scanTraces(blob);
  assert.ok(traces.some(t => t.kind === 'exif' && /Nikon/.test(t.detail)));
  assert.ok(traces.some(t => t.kind === 'gps'));
  // EOI harus dipertahankan (bug: walker JPEG membuang EOI terakhir).
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes[bytes.length - 2], 0xff);
  assert.equal(bytes[bytes.length - 1], 0xd9);
});

test('JPEG: hapus GPS -> re-parse GPS hilang, Make/Model utuh', async () => {
  const fields = await listEditableFields(jpgBlob(), 'jejak-exif.jpg', Date.now());
  const gps = fields.find(f => f.kind === 'exif-gps');
  const { blob, skipped } = await applyFieldEdits(jpgBlob(), [{ id: gps.id, action: 'delete' }], fields);
  assert.deepEqual(skipped, []);
  const traces = await scanTraces(blob);
  assert.equal(traces.some(t => t.kind === 'gps'), false, 'GPS harus hilang: ' + JSON.stringify(traces));
  assert.ok(traces.some(t => t.kind === 'exif' && /Canon/.test(t.detail)), 'EXIF Make harus utuh');
  const after = await listEditableFields(blob, 'jejak-exif.jpg', Date.now());
  assert.equal(after.find(f => f.kind === 'exif-gps'), undefined);
  assert.match(after.find(f => f.label === 'Model')?.value || '', /EOS R50/);
  // EOI harus dipertahankan (bug: walker JPEG membuang EOI terakhir).
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes[bytes.length - 2], 0xff);
  assert.equal(bytes[bytes.length - 1], 0xd9);
});

test('PNG: edit tEXt in-place + hapus -> CRC semua chunk valid', async () => {
  const pngBuf = readFileSync(new URL('./fixtures/matrix/png-text.png', import.meta.url));
  const pngBlob = new Blob([pngBuf], { type: 'image/png' });
  const fields = await listEditableFields(pngBlob, 'png-text.png', Date.now());
  const sw = fields.find(f => f.kind === 'png-chunk' && f.keyword === 'Software');
  assert.ok(sw, 'chunk tEXt Software harus ada');
  assert.match(sw.value, /OpenAI DALL-E/); // fixture matrix pakai hyphen ASCII
  const edited = await applyFieldEdits(pngBlob, [{ id: sw.id, action: 'edit', value: 'Test' }], fields);
  assert.deepEqual(edited.skipped, []);
  const chunks = listPngChunks(Buffer.from(await edited.blob.arrayBuffer()));
  assert.ok(chunks.every(c => c.crcOk), 'semua CRC harus valid setelah edit');
  const swChunk = chunks.find(c => c.type === 'tEXt');
  assert.ok(swChunk && swChunk.data.toString('latin1').includes('Test'), 'nilai baru harus ada di chunk');
  // Gambar tetap bisa di-decode setelah edit.
  decodePng(Buffer.from(await edited.blob.arrayBuffer()));
  const deleted = await applyFieldEdits(pngBlob, [{ id: sw.id, action: 'delete' }], fields);
  assert.deepEqual(deleted.skipped, []);
  const chunks2 = listPngChunks(Buffer.from(await deleted.blob.arrayBuffer()));
  assert.ok(chunks2.every(c => c.crcOk), 'semua CRC harus valid setelah hapus');
  assert.equal(chunks2.find(c => c.type === 'tEXt' && c.data.toString('latin1').startsWith('Software\0')), undefined, 'chunk tEXt Software harus hilang (chunk tEXt lain boleh tetap ada)');
  decodePng(Buffer.from(await deleted.blob.arrayBuffer()));
});
