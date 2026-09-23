const CACHE_NAME = 'zarephia-dictionary-pwa-v3-1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, {cache:'no-store'})
        .then(res => {
          if (res && res.ok) {
            const copy=res.clone();
            caches.open(CACHE_NAME).then(c => c.put('./index.html', copy)).catch(()=>{});
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then(cached => cached || new Response('Offline', {status:503})))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if(cached) return cached;
      return fetch(req).then(res => {
        if(res && res.ok){
          const copy=res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(()=>{});
        }
        return res;
      });
    })
  );
});
