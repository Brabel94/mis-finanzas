// ============================================================
// MisFinanzas — Service Worker
// Estrategia: Cache First para recursos estáticos,
//             Network First para Firebase (sincronización)
// ============================================================

const CACHE_NAME    = 'misfinanzas-v1';
const OFFLINE_URL   = './index.html';

// Recursos que se cachean al instalar
const PRECACHE = [
  './index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

// ── Instalación: precachear recursos esenciales ─────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE);
    }).then(function() {
      return self.skipWaiting(); // activar inmediatamente
    })
  );
});

// ── Activación: limpiar cachés antiguas ──────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key)   { return caches.delete(key); })
      );
    }).then(function() {
      return self.clients.claim(); // tomar control inmediato
    })
  );
});

// ── Fetch: estrategia según el tipo de recurso ───────────────
self.addEventListener('fetch', function(event) {
  const url = event.request.url;

  // Firebase, Google APIs y autenticación → siempre Network
  // (no cachear tokens ni datos personales)
  if (
    url.includes('firestore.googleapis.com') ||
    url.includes('firebase.googleapis.com')  ||
    url.includes('identitytoolkit.googleapis.com') ||
    url.includes('securetoken.googleapis.com') ||
    url.includes('firebaseapp.com') ||
    url.includes('gstatic.com/firebasejs')
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Solo manejar GET
  if (event.request.method !== 'GET') return;

  // Para index.html → Network First (siempre intenta la versión más reciente)
  // Si no hay red, sirve desde caché
  if (url.includes('index.html') || url.endsWith('/') || url === self.location.origin + '/') {
    event.respondWith(
      fetch(event.request)
        .then(function(networkResponse) {
          // Actualizar caché con versión nueva
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
          return networkResponse;
        })
        .catch(function() {
          // Sin red → servir desde caché
          return caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  // CDN (Chart.js, SheetJS) → Cache First
  // Si no está en caché, descarga y guarda
  if (url.includes('cdnjs.cloudflare.com')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(networkResponse) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
          return networkResponse;
        });
      })
    );
    return;
  }

  // Resto → Network con fallback a caché
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request);
    })
  );
});

// ── Mensaje desde la app para forzar actualización ──────────
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
