'use strict';

const CACHE_PREFIX = 'meal-plan-';
const CACHE_VERSION = 'v7';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './schema/nutrition_baseline.json',
  './js/macroEngine.js',
  './js/state.js',
  './js/geminiPrompts.js',
  './js/views/mealsView.js',
  './js/views/prepView.js',
  './js/views/groceriesView.js',
  './js/views/settingsView.js',
  './js/app.js',
  './data.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const OPTIONAL_LOCAL_ASSETS = ['./public/data.json'];

const SCOPE_URL = new URL('./', self.location.href).href;
const INDEX_URL = new URL('./index.html', self.location.href).href;
const DATA_URL = new URL('./data.json', self.location.href).href;
const PUBLIC_DATA_URL = new URL('./public/data.json', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);

    await Promise.allSettled(
      OPTIONAL_LOCAL_ASSETS.map(async (assetPath) => {
        const resp = await fetch(new Request(assetPath, { cache: 'reload' }));
        if (resp && resp.ok) {
          await cache.put(assetPath, resp);
        }
      }),
    );

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 1. Cache-busted data sync (?t=...) -> Network-Only + canonical cache update
  const baseUrl = `${url.origin}${url.pathname}`;
  if ((baseUrl === DATA_URL || baseUrl === PUBLIC_DATA_URL) && url.searchParams.has('t')) {
    event.respondWith(handleCacheBustedData(event.request, baseUrl));
    return;
  }

  // 2. Same-origin app shell & normal data.json -> Stale-While-Revalidate
  if (url.origin === self.location.origin && url.href.startsWith(SCOPE_URL)) {
    event.respondWith(handleSameOriginSwr(event));
  }
});

async function handleCacheBustedData(request, baseUrl) {
  const cache = await caches.open(CACHE_NAME);
  const isPublic = baseUrl === PUBLIC_DATA_URL;
  const canonicalKey = isPublic ? PUBLIC_DATA_URL : DATA_URL;
  const fallbackKey = isPublic ? DATA_URL : PUBLIC_DATA_URL;

  try {
    const networkResp = await fetch(request, { cache: 'no-store' });
    if (networkResp && networkResp.ok) {
      await cache.put(canonicalKey, networkResp.clone());
      return networkResp;
    }
    if (networkResp && networkResp.status >= 500) {
      const cached = (await cache.match(canonicalKey)) || (await cache.match(fallbackKey));
      if (cached) return cached;
    }
    return networkResp;
  } catch (_) {
    const cached = (await cache.match(canonicalKey)) || (await cache.match(fallbackKey));
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline and no cached data available' }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleSameOriginSwr(event) {
  const cache = await caches.open(CACHE_NAME);
  const isNavigate = event.request.mode === 'navigate';
  const cached = await cache.match(event.request);

  const networkPromise = fetch(event.request)
    .then(async (resp) => {
      if (resp && resp.ok && !resp.redirected) {
        await cache.put(event.request, resp.clone());
      }
      return resp;
    })
    .catch(() => undefined);

  if (cached && (!isNavigate || (!cached.redirected && cached.type !== 'opaqueredirect'))) {
    event.waitUntil(networkPromise);
    return cached;
  }

  const netResp = await networkPromise;
  if (netResp) {
    if (!isNavigate) {
      return netResp;
    }
    if (netResp.type === 'opaqueredirect' || (netResp.ok && !netResp.redirected)) {
      return netResp;
    }
  }

  if (isNavigate) {
    const fallback = (await cache.match(INDEX_URL)) || (await cache.match(SCOPE_URL));
    if (fallback && !fallback.redirected && fallback.type !== 'opaqueredirect') {
      return fallback;
    }
    if (netResp && !netResp.redirected) {
      return netResp;
    }
  }

  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

self.addEventListener('message', (event) => {
  const data = event && event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'TIMER_COMPLETE') {
    const title = typeof data.title === 'string' && data.title.trim()
      ? data.title.trim()
      : 'Prep Timer Complete';
    const body = typeof data.body === 'string' && data.body.trim()
      ? data.body.trim()
      : 'Your batch cooking step timer has finished.';
    const tag = typeof data.tag === 'string' && data.tag.trim()
      ? data.tag.trim()
      : `prep-timer-${data.stepId || 'step'}`;

    if (self.registration && typeof self.registration.showNotification === 'function') {
      event.waitUntil(
        self.registration
          .showNotification(title, {
            body,
            tag,
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png',
            data: { stepId: data.stepId || null, url: './' },
          })
          .catch(() => {})
      );
    }
  }
});

self.addEventListener('notificationclick', (event) => {
  if (event.notification && typeof event.notification.close === 'function') {
    event.notification.close();
  }

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    for (const client of allClients) {
      if (client && typeof client.focus === 'function') {
        await client.focus();
        return;
      }
    }
    if (self.clients && typeof self.clients.openWindow === 'function') {
      await self.clients.openWindow('./');
    }
  })());
});
