// Service Worker for Loyalty Card & Store Owner Apps (Full Offline Support)
const CACHE_NAME = 'loyalty-apps-cache-v8-settings-theme-fix';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './owner.html',
  './download.html',
  './decode.html',
  './customer/index.html',
  './owner/index.html',
  './manifest.json',
  './manifest-owner.json',
  './css/style.css',
  './customer/css/style.css',
  './owner/css/style.css',
  './favicon.ico',
  './favicon.png',
  './favicon-64.png',
  './favicon.svg',
  './js/audio.js',
  './js/app.js',
  './js/owner.js',
  './customer/js/app.js',
  './owner/js/owner.js',
  './js/vendor/confetti.browser.min.js',
  './js/vendor/html5-qrcode.min.js',
  './js/vendor/qrcode.min.js',
  './js/vendor/supabase.min.js',
  './js/supabase-client.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/owner-icon-192.png',
  './icons/owner-icon-512.png',
  './assets/logo.png',
  './assets/store_bg.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Cache prefetch warning:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // If this is an API call or version check, always fetch fresh from network
  if (event.request.url.includes('/api/') || event.request.url.includes('version.json')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ offline: true, error: "Network offline." }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Bypass Service Worker completely for APK file downloads so browser and OS handle them natively
  if (event.request.url.match(/\.apk($|\?)/i) || event.request.url.includes('/apks/')) {
    return;
  }

  // Network first with cache fallback for HTML/JS/CSS, Cache first for images/fonts
  const isStaticAsset = event.request.url.match(/\.(png|jpg|jpeg|svg|woff2|woff|ttf|ico)$/);

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        }).catch(() => caches.match('./favicon.png'));
      })
    );
  } else {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && event.request.method === 'GET') {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then(cached => {
            if (cached) return cached;
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html') || caches.match('./download.html');
            }
            return null;
          });
        })
    );
  }
});

// System Push & Background Notification Handlers
self.addEventListener('push', (event) => {
  let data = { title: "⚡ Loyalty Pass Update Ready!", body: "A new update is available. Tap to install!" };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (_) {}
  const options = {
    body: data.body || "New version available! Tap to install.",
    icon: './icons/icon-192.png',
    badge: './favicon-64.png',
    vibrate: [200, 100, 200],
    data: { url: './index.html' }
  };
  event.waitUntil(self.registration.showNotification(data.title || "⚡ Loyalty Pass Update Ready!", options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./index.html');
      }
    })
  );
});
