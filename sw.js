const CACHE = 'piratas-pwa-v2';
const ASSETS = [
  '/piratas-calendario/',
  '/piratas-calendario/index.html',
  '/piratas-calendario/styles.css',
  '/piratas-calendario/app.js',
  '/piratas-calendario/manifest.json',
  '/piratas-calendario/icons/icon-192.svg',
  '/piratas-calendario/icons/icon-192.png',
  '/piratas-calendario/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('api.github.com')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(
      res => { const r = res.clone(); caches.open(CACHE).then(c => c.put(e.request, r)); return res; }
    ).catch(() => new Response('Sin conexión', { status: 503 })))
  );
});
