const CACHE = 'sfs-v5';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always network-first for HTML and API calls — never serve stale
  if (e.request.headers.get('accept')?.includes('text/html') ||
      url.pathname === '/' ||
      url.pathname === '/index.html' ||
      url.pathname.includes('/.netlify/functions/') ||
      url.hostname.includes('api.espn.com')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Cache-first for static assets (icons, manifest)
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
