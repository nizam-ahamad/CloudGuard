// Minimal cache-through service worker for PWA install eligibility
const CACHE_NAME = 'cloudguard-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through network fetch to satisfy Chromium PWA criteria
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});


