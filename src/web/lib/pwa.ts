/**
 * Service worker registration and the update handshake.
 *
 * Cookies: the browser sends same-origin cookies with the `/sw.js` request, so
 * an authenticated app needs no attribute for it (unlike the manifest, which
 * needs `crossorigin="use-credentials"` on its link tag). What does break an
 * auth-gated deployment is a *redirect* — a service worker script response is
 * not allowed to redirect, so an auth proxy that bounces `/sw.js` to a login
 * page fails registration outright. Exempt `/sw.js` and `/manifest.webmanifest`
 * from redirect-based auth at the proxy.
 */

let registered = false

export function registerServiceWorker(onUpdateReady: (applyUpdate: () => void) => void): void {
  if (!('serviceWorker' in navigator) || registered) return
  registered = true

  if (import.meta.env.DEV) {
    // A worker left behind by a production build on the same host would happily
    // serve stale assets over the dev server.
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
    return
  }

  const start = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        // Always revalidate the worker script itself against the network.
        updateViaCache: 'none',
      })

      const announce = (worker: ServiceWorker) =>
        onUpdateReady(() => worker.postMessage('SKIP_WAITING'))

      // A worker that finished installing while the tab was closed.
      if (registration.waiting) announce(registration.waiting)

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return

        installing.addEventListener('statechange', () => {
          // A controller already exists, so this is an update rather than the
          // first install — the first install must not prompt anyone.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            announce(installing)
          }
        })
      })

      let reloading = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return
        reloading = true
        window.location.reload()
      })
    } catch (error) {
      // Never fatal: the app works fine without a worker.
      console.warn('[pwa] service worker registration failed', error)
    }
  }

  // Registration competes with the first paint, so it waits for load — but the
  // effect that calls this often runs *after* load has already fired, in which
  // case the listener would never run.
  if (document.readyState === 'complete') void start()
  else window.addEventListener('load', () => void start(), { once: true })
}
