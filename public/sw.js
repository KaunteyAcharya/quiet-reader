// Offline shell: network-first for the app files, never caches /api.
const C = 'quiet-shell-v3';
const SHELL = ['/', '/styles.css', '/js/app.js', '/js/store.js', '/js/ui.js', '/js/themes.js', '/js/writer.js', '/js/md.js', '/save.html', '/js/save.js', '/js/offline.js', '/js/tour.js', '/js/ink.js'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(C).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(C).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
