// Proptimizr service worker.
// Kept deliberately minimal: this is an auth-gated, data-heavy app, so we do NOT
// cache the application shell (stale pages would show the wrong tenant's data).
// We only (a) make the app installable and (b) serve a friendly offline page for
// navigations that fail while the device is offline.

const OFFLINE_URL = "/offline.html";
const CACHE = "proptimizr-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL])).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only intervene on top-level navigations; let everything else hit the network
  // normally (APIs, server actions, assets must never be served stale).
  if (request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(() => caches.match(OFFLINE_URL).then((r) => r ?? Response.error()))
  );
});
