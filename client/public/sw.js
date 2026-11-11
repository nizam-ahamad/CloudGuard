// Minimal cache-through service worker for PWA install eligibility
const CACHE_NAME = 'cloudguard-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Let browser handle normal network requests without intercepting API or S3 streams
  return;
});

