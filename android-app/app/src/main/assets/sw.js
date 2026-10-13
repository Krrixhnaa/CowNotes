const CACHE_NAME = 'cownotes-v46';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/css/ios-theme.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass through WebSocket, downloads and API mutations
  if (event.request.url.includes('/ws') || event.request.url.includes('/download/') || (event.request.method !== 'GET')) {
    return;
  }

  // Network first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
