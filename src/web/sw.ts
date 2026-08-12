/// <reference lib="webworker" />

/**
 * Service worker.
 *
 * Built separately from the app bundle by scripts/sw-plugin.ts, which injects
 * the precache manifest below from the actual build output. Deliberately small
 * and hand-written — Workbox brings a build-time dependency tree for behaviour
 * that is a few dozen lines here.
 *
 * Strategies:
 *   /api/*            untouched — the network is the source of truth. Offline
 *                     write queueing lands here later.
 *   navigations       network first (with navigation preload), falling back to
 *                     the cached shell so a refresh works offline.
 *   /assets/*         cache first — the filenames are content-hashed, so a hit
 *                     can never be stale.
 *   everything else   stale while revalidate.
 */

declare const self: ServiceWorkerGlobalScope & {
  __SW_VERSION__: string
  __SW_PRECACHE__: string[]
}

const VERSION = self.__SW_VERSION__
const PRECACHE = self.__SW_PRECACHE__
const CACHE_NAME = `app-${VERSION}`
const SHELL = '/index.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      // `reload` bypasses the HTTP cache so a new worker never precaches the
      // bytes the previous version already had.
      await cache.addAll(
        PRECACHE.map((url) => new Request(url, { cache: 'reload', credentials: 'same-origin' })),
      )
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable()
      }
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

/** The page asks for this once the user accepts an update. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

async function networkFirst(event: FetchEvent): Promise<Response> {
  try {
    const preloaded = (await event.preloadResponse) as Response | undefined
    const response = preloaded ?? (await fetch(event.request))
    // Keep the shell fresh for the next offline start.
    if (response.ok && event.request.mode === 'navigate') {
      const cache = await caches.open(CACHE_NAME)
      await cache.put(SHELL, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(SHELL)
    if (cached) return cached
    return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME)
    await cache.put(request, response.clone())
  }
  return response
}

async function staleWhileRevalidate(request: Request): Promise<Response> {
  const cached = await caches.match(request)

  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME)
        await cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => undefined)

  return cached ?? (await network) ?? Response.error()
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never intercept the API: stale data is worse than no data, and the sync
  // layer that will own this needs a clean slate.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(event))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
    return
  }

  event.respondWith(staleWhileRevalidate(request))
})
