import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const text=async(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('editor groups tool, version, result and download by file context',async()=>{
  const html=await text('index.html');
  const editor=html.slice(html.indexOf('id="editorHead"'),html.indexOf('<!-- Terakhir'));
  const detail=editor.indexOf('class="studio-detail-column"');
  assert.ok(detail>=0 && editor.indexOf('id="toolBar"',detail)>0);
  assert.ok(editor.indexOf('id="shellVersions"')<detail,'version selector with preview');
  assert.ok(editor.indexOf('id="primaryBtn"',detail)>0,'download beside result');
  assert.ok(editor.indexOf('id="saveDock"',detail)>0,'download in editor detail');
  assert.ok(editor.indexOf('id="settingsCard"',detail)>0,'settings in detail column');
  assert.ok(editor.indexOf('id="inspectorDisclosure"',detail)>editor.indexOf('id="primaryBtn"',detail),'inspector is secondary');
  assert.match(html,/id="editorThemeBtn"/);
  assert.match(html,/id="editorHistoryBtn"/);
  assert.match(html,/id="editorAddBtn"/);
});
test('changed export options require apply; download never silently invokes share',async()=>{
  const app=await text('src/app.ts');
  assert.match(app,/function cleanSettingsOutdated\(/);
  assert.match(app,/item\.cleanSignature=appliedSignature/);
  assert.match(app,/btn\.textContent="Terapkan perubahan"/);
  assert.match(app,/btn\.textContent=n>=2\?"Unduh semua/);
  assert.match(app,/if\(!it\.cleanedBlob \|\| it\.currentLabel==="Asli"\) return/);
  const save=app.slice(app.indexOf('async function saveItem('),app.indexOf('function openPreview('));
  assert.doesNotMatch(save,/navigator\.share\(/);
});
test('adaptive hierarchy and no legacy hidden-panel override',async()=>{
  const css=await text('src/studio.css');
  const old=await text('src/style.css');
  assert.match(css,/@media \(max-width:1050px\)/);
  assert.match(css,/@media \(max-width:600px\)/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(old,/body\.has-files #panel-cleaner\{display:block !important\}/);
});

test('original mode is explicit and queued files do not silently disappear',async()=>{
  const app=await text('src/app.ts');
  assert.match(app,/Sedang melihat versi asli\. Pilih Bersih untuk kembali ke hasil siap unduh/);
  assert.match(app,/queuedToolRun=\{tool:"clean",id:created\[0\]\.id\}/);
  assert.match(app,/var next=queuedToolRun/);
  assert.match(app,/un\.setAttribute\("aria-label",shellComparing\?/);
});
