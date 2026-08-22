// Minimale service worker - enkel nodig zodat Chrome/Android de pagina als
// installeerbare app herkent. Geen offline-caching-ambities voor de live
// getijgegevens (/api/tidalvectors) - die moeten altijd van het netwerk
// komen; enkel de vaste app-schil wordt in cache gezet.

const CACHE_NAAM = 'getijkrachten-v1';
const BESTANDEN = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAAM).then((cache) => cache.addAll(BESTANDEN))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cache_resultaat) => cache_resultaat || fetch(event.request))
  );
});
