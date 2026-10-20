const CACHE = 'book-galpi-v9';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './src/app.js',
  './src/domain.js',
  './src/integrations.js',
  './manifest.webmanifest',
  './vendor/zbar-wasm.js',
  './vendor/zbar.wasm',
  './vendor/barcode-detector-polyfill.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const networkResponse = await fetch(event.request);
      if (networkResponse.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, networkResponse.clone());
      }
      return networkResponse;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') return caches.match('./index.html');
      throw new Error('offline and not cached');
    }
  })());
});
