'use strict';

const CACHE_PREFIX = 'meal-plan-';
const CACHE_VERSION = 'v1';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './js/macroEngine.js',
  './js/app.js',
  './data.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const OPTIONAL_LOCAL_ASSETS = ['./public/data.json'];
const TAILWIND_CDN_URL = 'https://cdn.tailwindcss.com/';

const SCOPE_URL = new URL('./', self.location.href).href;
const INDEX_URL = new URL('./index.html', self.location.href).href;
const DATA_URL = new URL('./data.json', self.location.href).href;
const PUBLIC_DATA_URL = new URL('./public/data.json', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);

    await Promise.allSettled([
      ...OPTIONAL_LOCAL_ASSETS.map(async (assetPath) => {
        const resp = await fetch(new Request(assetPath, { cache: 'reload' }));
        if (resp && resp.ok) {
          await cache.put(assetPath, resp);
        }
      }),
      (async () => {
        try {
          const corsResp = await fetch(TAILWIND_CDN_URL, {
            mode: 'cors',
            redirect: 'follow',
          });
          if (corsResp && corsResp.ok) {
            await cache.put(TAILWIND_CDN_URL, corsResp);
            return;
          }
        } catch (_) {
          // cdn.tailwindcss.com omits CORS headers; fall back to no-cors opaque caching
        }
        try {
          const opaqueResp = await fetch(TAILWIND_CDN_URL, {
            mode: 'no-cors',
            redirect: 'follow',
          });
          if (opaqueResp && (opaqueResp.ok || opaqueResp.type === 'opaque')) {
            await cache.put(TAILWIND_CDN_URL, opaqueResp);
          }
        } catch (_) {
          // Never abort SW install if offline or CDN unreachable
        }
      })(),
    ]);

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

  // 2. Tailwind CDN -> Cache-First + background revalidate (CORS/opaque safe)
  if (url.origin === 'https://cdn.tailwindcss.com') {
    event.respondWith(handleTailwindCdn(event, url));
    return;
  }

  // 3. Same-origin app shell & normal data.json -> Stale-While-Revalidate
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

async function handleTailwindCdn(event, url) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = url.pathname === '/' ? TAILWIND_CDN_URL : event.request;
  const cached =
    (await cache.match(event.request)) ||
    (url.pathname === '/' ? await cache.match(TAILWIND_CDN_URL) : undefined);
  const canServeCached = cached && (event.request.mode !== 'cors' || cached.type !== 'opaque');

  const revalidate = fetch(event.request)
    .then(async (resp) => {
      if (resp && (resp.ok || resp.type === 'opaque')) {
        await cache.put(cacheKey, resp.clone());
      }
      return resp;
    })
    .catch(() => undefined);

  if (canServeCached) {
    event.waitUntil(revalidate);
    return cached;
  }

  const netResp = await revalidate;
  if (netResp) return netResp;
  return new Response('/* Tailwind CDN offline */', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'application/javascript' },
  });
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
