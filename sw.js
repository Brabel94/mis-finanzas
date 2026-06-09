// ============================================================
// MisFinanzas — Service Worker con auto-actualización
// Cambia CACHE_VERSION para forzar actualización en todos
// los dispositivos. Se actualiza automáticamente al detectar
// cambios en index.html.
// ============================================================

const CACHE_VERSION = '2026-06-09T21-34';
const CACHE_NAME    = 'misfinanzas-' + CACHE_VERSION;
const OFFLINE_URL   = './index.html';

const PRECACHE = [
  './index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

// ── Instalación ──────────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) { return cache.addAll(PRECACHE); })
      .then(function() { return self.skipWaiting(); }) // activa inmediatamente sin esperar
  );
});

// ── Activación: elimina cachés de versiones anteriores ───────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(
          keys
            .filter(function(key) {
              // Elimina cualquier caché de MisFinanzas que no sea la versión actual
              return key.startsWith('misfinanzas-') && key !== CACHE_NAME;
            })
            .map(function(key) {
              console.log('[SW] Eliminando caché viejo:', key);
              return caches.delete(key);
            })
        );
      })
      .then(function() { return self.clients.claim(); }) // toma control inmediato de todas las pestañas
  );
});

// ── Fetch ────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  const url = event.request.url;

  // Firebase y Google APIs → siempre red, nunca caché
  if (
    url.includes('firestore.googleapis.com')       ||
    url.includes('firebase.googleapis.com')         ||
    url.includes('identitytoolkit.googleapis.com')  ||
    url.includes('securetoken.googleapis.com')      ||
    url.includes('firebaseapp.com')                 ||
    url.includes('gstatic.com/firebasejs')
  ) {
    event.respondWith(fetch(event.request).catch(function() {
      // Firebase offline → respuesta vacía para no bloquear la app
      return new Response('', { status: 503, statusText: 'Offline' });
    }));
    return;
  }

  // Solo manejar GET
  if (event.request.method !== 'GET') return;

  // index.html → Network First con actualización de caché
  if (
    url.includes('index.html') ||
    url.endsWith('/mis-finanzas/') ||
    url.endsWith('/mis-finanzas')  ||
    url === self.registration.scope
  ) {
    event.respondWith(
      fetch(event.request)
        .then(function(networkResponse) {
          // Guardamos la versión nueva en caché
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
          // Notificamos a todas las pestañas abiertas que hay update disponible
          self.clients.matchAll().then(function(clients) {
            clients.forEach(function(client) {
              client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
            });
          });
          return networkResponse;
        })
        .catch(function() {
          // Sin red → servir desde caché
          return caches.match(OFFLINE_URL).then(function(cached) {
            return cached || new Response('<h2>Sin conexión</h2><p>Abre la app con internet al menos una vez.</p>',
              { headers: { 'Content-Type': 'text/html' } });
          });
        })
    );
    return;
  }

  // CDN (Chart.js, SheetJS) → Cache First (raramente cambian)
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

// ── Mensajes desde la app ────────────────────────────────────
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
