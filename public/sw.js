// Offline shell: network-first for the app files, never caches /api.
const C = 'quiet-shell-v4';
const SHELL = ['/', '/styles.css', '/js/app.js', '/js/store.js', '/js/ui.js', '/js/themes.js', '/js/writer.js', '/js/md.js', '/save.html', '/js/save.js', '/js/offline.js', '/js/tour.js', '/js/ink.js', '/js/books.js', '/js/bookdb.js', '/js/pdflib.js', '/js/pdfview.js'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(C).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (u.pathname.startsWith('/vendor/')) { // the PDF engine: cached after first use so books open offline
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(C).then((c) => c.put(e.request, copy)); } return r; })));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(C).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
