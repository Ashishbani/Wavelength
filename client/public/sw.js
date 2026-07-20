// Minimal service worker — enables install-to-home-screen (PWA).
// Network-passthrough; a fetch handler is required for installability.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* pass through to network */ });
