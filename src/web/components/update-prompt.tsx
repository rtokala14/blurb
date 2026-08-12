import { Button } from '@/components/ui/button'
import { useServiceWorkerUpdate } from '@/lib/use-service-worker'

/**
 * Shown when the service worker has a newer build cached and ready.
 *
 * Deliberately a prompt rather than an automatic reload: swapping the page out
 * from under someone mid-task loses their work.
 */
export function UpdatePrompt() {
  const applyUpdate = useServiceWorkerUpdate()
  if (!applyUpdate) return null

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 mx-auto mb-4 flex w-fit items-center gap-3 rounded-lg border bg-card px-4 py-2 shadow-lg"
    >
      <span className="text-sm">A new version is ready.</span>
      <Button size="sm" onClick={applyUpdate}>
        Reload
      </Button>
    </div>
  )
}
