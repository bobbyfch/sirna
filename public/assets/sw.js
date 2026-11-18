/* Sirna — service worker: aset statis cache-first, halaman network-first.
   File ini tinggal di assets/ (satu-satunya folder yang disajikan artifact);
   saat deploy ke domain sendiri, salin sw.js ini ke root domain supaya
   scope-nya mencakup seluruh situs. */
var CACHE = 'sirna-v3'; /* v3: build Vite (JS/CSS bundel) — ganti cache biar klien lama nggak nyangkut di index.html inline-JS lama */
var ASSETS = [
  'logos/chatgpt.png', 'logos/firefly.png', 'logos/flux.png', 'logos/gemini.png',
  'logos/ideogram.png', 'logos/kling.png', 'logos/leonardo.png', 'logos/luma.png',
  'logos/metaai.png', 'logos/midjourney.png', 'logos/openai.png', 'logos/runway.png',
  'logos/sora.png', 'logos/stability.png', 'logos/veo.png',
  'mascot-tanaya-body.webp', 'mascot-tanaya-celebrate.webp', 'mascot-tanaya-hand.webp',
  'mascot-tanaya-work.webp',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
  'manifest.webmanifest'
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
