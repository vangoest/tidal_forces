// Service worker met network-first voor index.html (altijd de nieuwste
// versie proberen te halen) en cache-first voor de rest (icons, manifest —
// die veranderen toch bijna nooit). De live getijgegevens (/api/tidalvectors)
// worden nergens gecachet, die gaan altijd rechtstreeks naar het netwerk.

const CACHE_NAAM = 'getijkrachten-v2'; // altijd ophogen bij elke deploy
const BESTANDEN = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // nieuwe SW meteen laten wachten om actief te worden
  event.waitUntil(
    caches.open(CACHE_NAAM).then((cache) => cache.addAll(BESTANDEN))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((namen) =>
      Promise.all(
        namen
          .filter((naam) => naam !== CACHE_NAAM)
          .map((naam) => caches.delete(naam))
      )
    ).then(() => self.clients.claim()) // meteen controle nemen over open tabs/app
  );
});

self.addEventListener('fetch', (event) => {
  const is_index = event.request.url.includes('index.html') || event.request.mode === 'navigate';

  if (is_index) {
    // network-first: probeer het netwerk, val terug op cache bij offline
    event.respondWith(
      fetch(event.request)
        .then((netwerk_resultaat) => {
          caches.open(CACHE_NAAM).then((cache) => cache.put(event.request, netwerk_resultaat.clone()));
          return netwerk_resultaat;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // cache-first voor de rest (icons, manifest)
    event.respondWith(
      caches.match(event.request).then((cache_resultaat) => cache_resultaat || fetch(event.request))
    );
  }
});
