const CACHE = 'one-card-v2';
const ASSETS = [
  '/', '/index.html', '/game.html',
  '/game.js', '/lobby.js', '/style.css',
  '/manifest.json', '/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // 소켓·API는 캐시 안 함
  if (url.includes('/socket.io/') || url.includes('/api/')) return;
  e.respondWith(
    caches.match(e.request)
      .then(r => r || fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }))
  );
});
