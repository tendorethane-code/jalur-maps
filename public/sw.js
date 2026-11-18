// App shell cache so Jalur opens instantly and installs as an app.
// Same-origin files: network first (updates show up right away), cache as fallback.
// Map tiles, routing and search always go to the network and are never cached here.
const CACHE = 'jalur-v8';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'lib/api.js', 'lib/route-analysis.js', 'lib/search.js', 'lib/map.js', 'lib/google-places.js', 'config.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];
const CDN = ['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...SHELL, ...CDN])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CDN.includes(url.href)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
