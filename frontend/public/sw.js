// Minimal PWA: precache shell, cache-first hashed assets, SWR for navigations.
const CACHE = 'pool-v140-settings-cue';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon.svg', '/github-mark-white.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/fonts/AtkinsonHyperlegible-Regular.woff2', '/fonts/AtkinsonHyperlegible-Bold.woff2'];
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
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    })));
  } else if (e.request.mode === 'navigate' && ['/', '/index.html', '/terms.html', '/privacy.html'].includes(url.pathname)) {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone();
      if (r.ok) caches.open(CACHE).then((c) => c.put(url.pathname === '/' ? '/index.html' : url.pathname, copy));
      return r;
    }).catch(() => caches.match(url.pathname === '/' ? '/index.html' : url.pathname).then(hit => hit ?? new Response('This page is unavailable offline.', {status:503}))));
  }
});
