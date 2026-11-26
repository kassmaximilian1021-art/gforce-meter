// ====================================
// Service Worker — 離線快取策略
// 採用 Cache-First 策略，優先從快取讀取
// ====================================

// Bump this name whenever deployed assets change so installed PWAs refresh their cache.
const CACHE_NAME = 'gforce-meter-v25';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json?v=2',
  './icon-192.png?v=2',
  './icon-512.png?v=2',
  './apple-touch-icon.png?v=2',
  './favicon.ico?v=2',
  './css/styles.css?v=24',
  './js/filter.js',
  './js/sensor.js',
  './js/audio.js',
  './js/threshold.js',
  './js/storage.js',
  './js/chart.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((name) => name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((response) => {
        if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        return response;
      });
    }).catch(() => caches.match('./index.html'))
  );
});
