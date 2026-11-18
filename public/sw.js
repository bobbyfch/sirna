/* Sirna — service worker: aset statis cache-first, halaman network-first.
   Salinan root untuk deploy Cloudflare Workers: didaftarkan sebagai /sw.js
   supaya scope-nya mencakup seluruh situs. Daftar aset di bawah memakai
   path dari root (assets/...), karena dari root, path relatif 'logos/...'
   akan salah arah ke /logos/... Salinan asli yang tinggal di assets/
   (dipakai artefak Muse) tetap ada di public/assets/sw.js. */
var CACHE = 'sirna-v3'; /* v3: build Vite (JS/CSS bundel) — ganti cache biar klien lama nggak nyangkut di index.html inline-JS lama */
var ASSETS = [
  'assets/logos/chatgpt.png', 'assets/logos/firefly.png', 'assets/logos/flux.png', 'assets/logos/gemini.png',
  'assets/logos/ideogram.png', 'assets/logos/kling.png', 'assets/logos/leonardo.png', 'assets/logos/luma.png',
  'assets/logos/metaai.png', 'assets/logos/midjourney.png', 'assets/logos/openai.png', 'assets/logos/runway.png',
  'assets/logos/sora.png', 'assets/logos/stability.png', 'assets/logos/veo.png',
  'assets/mascot-tanaya-body.webp', 'assets/mascot-tanaya-celebrate.webp', 'assets/mascot-tanaya-hand.webp',
  'assets/mascot-tanaya-work.webp',
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png', 'assets/apple-touch-icon.png',
  'assets/manifest.webmanifest'
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (r) {
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return r;
    }).catch(function () { return caches.match(req); }));
    return;
  }
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (r) {
      if (r.ok && new URL(req.url).origin === self.location.origin) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return r;
    });
  }));
});
