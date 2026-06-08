// Sanjeevani Service Worker — minimal, install-friendly, offline-aware.
// Versioned cache so a redeploy invalidates old assets cleanly.

const VERSION = 'sj-v4';
const CORE_CACHE = `${VERSION}-core`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// Bare minimum to satisfy the PWA installability "fetch handler" requirement
// and give an offline shell. We do NOT pre-cache external CDN scripts/fonts —
// the network-first runtime cache handles them.
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/config.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .catch(() => {/* offline / missing files: don't block install */})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Strategy:
// - /api/* → network only (don't cache — these are auth-aware proxies)
// - Supabase / Gemini / Google → network only (auth + freshness)
// - Same-origin navigations → network-first, fall back to cached index.html
// - Static same-origin assets → stale-while-revalidate
// - Cross-origin (Tailwind CDN, Google Fonts) → cache-first, refresh in background
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isApi = sameOrigin && url.pathname.startsWith('/api/');
  const isAuthHost = /supabase\.co$|googleapis\.com$|google\.com$|gstatic\.com$/.test(url.hostname);

  if (isApi || isAuthHost) {
    // Always go to network — don't intercept auth/proxy/API responses
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  if (sameOrigin) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  // Cross-origin static (fonts, CDN scripts) — cache-first
  event.respondWith(cacheFirst(req, RUNTIME_CACHE));
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => {
    if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || network;
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.status === 200 || res.type === 'opaque')) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (e) {
    return cached || new Response('', { status: 504, statusText: 'Offline' });
  }
}

// Allow the page to ask the SW to update itself immediately after a deploy
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
