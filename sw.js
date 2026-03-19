// ============================================================
// CoursPool — Service Worker v2
// Gère : cache PWA + notifications push
// ============================================================

const CACHE = 'courspool-v2';

// ── Installation & cache ────────────────────────────────────
self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

// ── Notifications push ──────────────────────────────────────
self.addEventListener('push', function(e) {
  if (!e.data) return;

  var payload;
  try { payload = e.data.json(); }
  catch(err) { payload = { title: 'CoursPool', body: e.data.text() }; }

  var title   = payload.title  || 'CoursPool';
  var options = {
    body:    payload.body    || '',
    icon:    payload.icon    || '/icon-192.png',
    badge:   payload.badge   || '/icon-72.png',
    image:   payload.image   || undefined,
    tag:     payload.tag     || 'courspool-notif',
    renotify: true,
    data:    payload.data    || { url: 'https://courspool.vercel.app' },
    actions: payload.actions || [],
    vibrate: [200, 100, 200],
  };

  // Couleur Android (Chrome)
  if (payload.color) options.color = payload.color;

  e.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Clic sur la notif ────────────────────────────────────────
self.addEventListener('notificationclick', function(e) {
  e.notification.close();

  var url = (e.notification.data && e.notification.data.url)
    ? e.notification.data.url
    : 'https://courspool.vercel.app';

  // Action custom
  if (e.action && e.notification.data && e.notification.data[e.action]) {
    url = e.notification.data[e.action];
  }

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(cs) {
      // Fenêtre déjà ouverte → focus
      for (var i = 0; i < cs.length; i++) {
        if (cs[i].url.includes('courspool') && 'focus' in cs[i]) {
          return cs[i].focus();
        }
      }
      // Sinon ouvrir
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Fermeture notif ──────────────────────────────────────────
self.addEventListener('notificationclose', function(e) {
  // Analytics optionnel
});
