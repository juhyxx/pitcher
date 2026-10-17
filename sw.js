// Service worker template. scripts/build.js fills in VERSION and ASSETS; every
// build with different content gets a new cache name, which makes browsers
// install the new worker and drop the old cache.
const VERSION = '__VERSION__';
const ASSETS = [/* __ASSETS__ */];
const CACHE_PREFIX = 'pitcher-';
const CACHE = CACHE_PREFIX + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Bypass the HTTP cache so a new version never precaches stale files.
      cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// The page asks a waiting worker to take over when the user accepts the update.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(request);
      } catch (err) {
        if (request.mode === 'navigate') return cache.match('./');
        throw err;
      }
    })(),
  );
});
