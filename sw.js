// ====================================
// Service Worker — 離線快取策略
// 採用 Cache-First 策略，優先從快取讀取
// ====================================

const CACHE_NAME = 'gforce-meter-v5';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.ico',
  './css/styles.css',
  './js/filter.js',
  './js/sensor.js',
  './js/audio.js',
  './js/threshold.js',
  './js/storage.js',
  './js/chart.js',
  './js/app.js'
];

// 安裝事件：快取所有靜態資源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  // 立即啟用，不等待舊的 SW 結束
  self.skipWaiting();
});

// 啟用事件：清除舊版本快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // 立即接管所有頁面
  self.clients.claim();
});

// 攔截請求：Cache-First 策略
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        // 不快取非 GET 請求或來自其他 origin 的請求
        if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
          return response;
        }
        // 複製 response 並存入快取
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      });
    }).catch(() => {
      // 離線 fallback
      return caches.match('./index.html');
    })
  );
});
