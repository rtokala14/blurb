import { useEffect, useState } from 'react'
import { registerServiceWorker } from './pwa'

/**
 * Registers the service worker and reports when a new version is waiting.
 * Returns the function that activates it, or null when there is nothing to do.
 */
export function useServiceWorkerUpdate(): (() => void) | null {
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null)

  useEffect(() => {
    // registerServiceWorker is idempotent, which matters under StrictMode.
    registerServiceWorker((apply) => setApplyUpdate(() => apply))
  }, [])

  return applyUpdate
}
