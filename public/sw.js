const CACHE_NAME = 'recallforge-v2';
const STATIC_ASSETS = [
  '/',
  '/dashboard',
  '/manifest.json',
];

// Install: cache shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first for navigations, cache-first for assets
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api') || url.origin !== self.location.origin) return;

  // Navigation requests: network-first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function(response) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
          return response;
        })
        .catch(function() {
          return caches.match(request).then(function(cached) {
            return cached || caches.match('/');
          });
        })
    );
    return;
  }

  // Static assets: stale-while-revalidate
  if (
    url.pathname.startsWith('/_next/static') ||
    /\.(js|css|woff2?|png|jpg|svg|ico)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then(function(cached) {
        var fetchPromise = fetch(request).then(function(response) {
          caches.open(CACHE_NAME).then(function(cache) { cache.put(request, response.clone()); });
          return response;
        });
        return cached || fetchPromise;
      })
    );
    return;
  }
});

// Background sync for offline review logs
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-reviews') {
    event.waitUntil(syncReviews());
  }
});

// Push notification handler
self.addEventListener('push', function(event) {
  var data = { title: 'RecallForge', body: 'Tenés tarjetas pendientes' };

  if (event.data) {
    try { data = event.data.json(); } catch (e) { data.body = event.data.text(); }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'recallforge-notification',
      data: data.data || {},
      actions: data.actions || [
        { action: 'study', title: 'Estudiar' },
        { action: 'dismiss', title: 'Después' },
      ],
    })
  );
});

// Notification click handler
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var url = '/dashboard';
  if (event.action === 'study') {
    url = '/study';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].url.includes('/dashboard') || clients[i].url.includes('/study')) {
          return clients[i].focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

async function syncReviews() {
  var clients = await self.clients.matchAll();
  clients.forEach(function(client) {
    client.postMessage({ type: 'SYNC_REQUESTED' });
  });
}
