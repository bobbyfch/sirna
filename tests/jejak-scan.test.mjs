// Node unit test: scanTraces (src/jejak.ts) pada file jejak buatan tangan.
// JPEG EXIF (Make/Model/DateTime/Software + GPS S 6°10'30" E 106°45'0"),
// PNG eXIf yang sama, WebP EXIF yang sama, dan PNG bersih (0 jejak).
// Di-transpile dengan tsc proyek — scanTraces murni ArrayBuffer,
// tidak butuh DOM.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";

// tsc standalone dengan moduleResolution nodenext melaporkan TS2835/
// TS2339 palsu (impor "./erase" tanpa ekstensi + EraseHooks tak
// ter-resolve) — tsc proyek (bundler) lolos bersih, dan emit JS tetap
// dihasilkan, jadi exit code diabaikan.
spawnSync("./node_modules/.bin/tsc", ["src/jejak.ts", "--ignoreConfig", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022", "--outDir", "/tmp/jejak-ts-out", "--skipLibCheck"], { cwd: "/home/hatch/workspace/sirna-vite" });
const { scanTraces, filenameTrace } = await import("/tmp/jejak-ts-out/jejak.js");

const log = [];
const note = (k, v) => { log.push([k, v]); console.log("##", k, "=", typeof v === "string" ? v : JSON.stringify(v)); };

const jpg = await scanTraces(new Blob([readFileSync("tests/fixtures/jejak-exif.jpg")], { type: "image/jpeg" }));
note("jpgTraces", jpg);
assert.equal(jpg.length, 2); // EXIF + GPS
assert.equal(jpg[0].kind, "exif");
assert.match(jpg[0].detail, /Canon/);
assert.match(jpg[0].detail, /EOS R50/);
assert.match(jpg[0].detail, /2026:11:18 14:32:01/);
assert.equal(jpg[1].kind, "gps");
assert.match(jpg[1].detail, /6°10′30″S/);
assert.match(jpg[1].detail, /106°45′0″E/);

const png = await scanTraces(new Blob([readFileSync("tests/fixtures/jejak-exif.png")], { type: "image/png" }));
note("pngTraces", png);
assert.equal(png.length, 2); // EXIF + GPS
assert.equal(png[0].kind, "exif");
assert.match(png[0].detail, /Canon/);
assert.equal(png[1].kind, "gps");

const webp = await scanTraces(new Blob([readFileSync("tests/fixtures/jejak-exif.webp")], { type: "image/webp" }));
note("webpTraces", webp);
assert.equal(webp.length, 2); // EXIF + GPS
assert.equal(webp[0].kind, "exif");
assert.match(webp[0].detail, /EOS R50/);

const clean = await scanTraces(new Blob([readFileSync("tests/fixtures/erase-test.png")], { type: "image/png" }));
note("cleanPngTraces", clean);
assert.deepEqual(clean, []);

const fn1 = filenameTrace("IMG_20261118_143201.png");
note("filenameDate", fn1);
assert.ok(fn1 && /tanggal/.test(fn1.detail));
const fn2 = filenameTrace("foto-liburan.png");
note("filenameClean", fn2);
assert.equal(fn2, null);

writeFileSync("/tmp/jejak-scan-result.json", JSON.stringify(log, null, 2));
console.log("JEJAK SCAN UNIT TEST: PASS");
