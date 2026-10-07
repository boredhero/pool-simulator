// Minimal PWA: precache shell, cache-first hashed assets, SWR for navigations.
const CACHE = 'pool-v1';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon.svg'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    })));
  } else if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put('/index.html', copy));
      return r;
    }).catch(() => caches.match('/index.html')));
  }
});
