// Only the application shell is cached. Never cache bulletins, observations or tiles.
const CACHE = 'pyrenees-avalanche-v44-static';
const STATIC = ['/', '/index.html', '/style.css', '/app.js', '/translations.js', '/hazard-model.js', '/manifest.webmanifest', '/assets/app-icon.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pyrenees-avalanche-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin || !STATIC.includes(u.pathname)) return;
  e.respondWith(fetch(e.request).then(async response => {
    if (response.ok) { const cache = await caches.open(CACHE); await cache.put(e.request, response.clone()); }
    return response;
  }).catch(async () => (await caches.match(e.request)) || new Response('Offline: this resource is unavailable.', { status: 503 })));
});
