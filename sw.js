// Service Worker for 生活工作台 PWA
const CACHE = 'life-workbench-v28';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'notify') {
    self.registration.showNotification(data.title || '提醒', { body: data.body || '', icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' });
  }
});

// Network-first with cache fallback. Returns fresh content when online,
// and degrades to the cached copy when the network is slow/offline.
function networkFirst(req, cache) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cache.match(req).then((c) => resolve(c || fetch(req)));
    }, 2500);
    fetch(req).then((res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (res && res.status === 200) cache.put(req, res.clone());
      resolve(res);
    }).catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cache.match(req).then((c) => resolve(c || fetch(req)));
    });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // version.json: always network-first so the app can detect new releases
  // even on a resuming iOS home-screen PWA (where no navigation occurs).
  if (url.pathname.endsWith('version.json')) {
    event.respondWith(
      caches.open(CACHE).then((cache) => networkFirst(req, cache))
    );
    return;
  }

  const isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html') ||
    url.pathname === '/' || url.pathname.endsWith('.html');
  if (isHTML) {
    event.respondWith(
      caches.open(CACHE).then((cache) => networkFirst(req, cache))
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
