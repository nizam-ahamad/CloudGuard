// Minimal cache-through service worker for PWA install eligibility
const CACHE_NAME = 'cloudguard-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass service worker completely for non-GET methods, cross-origin requests (S3/B2), and backend APIs
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Pass-through network fetch to satisfy Chromium PWA criteria
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});


