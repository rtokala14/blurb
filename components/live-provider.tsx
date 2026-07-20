"use client"

import * as React from "react"
import { toast } from "sonner"

import { liveApi } from "@/lib/live-api"
import { useOrbit } from "@/lib/store"
import { hydrateFromBootstrap } from "@/components/live-hydrate"

const DOC_STATUS_POLL_MS = 30_000

/**
 * Full-screen gate shown while the user identity + bootstrap resolve, so
 * demo seed data never flashes for live users.
 */
function ConnectingSplash({ label }: { label: string }) {
  return (
    <div className="bg-background fixed inset-0 z-50 flex flex-col items-center justify-center gap-6">
      <div className="flex items-center gap-3">
        <div className="from-primary to-chart-1 text-primary-foreground flex size-11 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm">
          <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
            <circle cx="12" cy="12" r="4" fill="currentColor" />
            <ellipse
              cx="12"
              cy="12"
              rx="10"
              ry="4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              transform="rotate(-20 12 12)"
            />
          </svg>
        </div>
        <div>
          <p className="text-lg leading-tight font-semibold tracking-tight">Orbit Docs</p>
          <p className="text-muted-foreground text-xs">Jacobs · Engineering Solutions</p>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="bg-primary size-1.5 animate-pulse rounded-full" />
          <span className="bg-primary size-1.5 animate-pulse rounded-full [animation-delay:150ms]" />
          <span className="bg-primary size-1.5 animate-pulse rounded-full [animation-delay:300ms]" />
        </div>
        <p className="text-muted-foreground text-sm">{label}</p>
      </div>
    </div>
  )
}

/**
 * Probes /api/orbit/config once on mount. In live mode, hydrates the store
 * from Foundry in a single bootstrap round-trip and keeps indexing statuses
 * fresh while documents are pending. In demo mode the seeded simulation
 * stays untouched. Children render only once the mode is known — and, in
 * live mode, once real data has replaced the demo seeds.
 */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const live = useOrbit((s) => s.live)
  const liveHydrated = useOrbit((s) => s.liveHydrated)

  // Restore the per-user profile/persona from localStorage once on the client.
  React.useEffect(() => {
    useOrbit.getState().hydrateUserProfile()
  }, [])

  React.useEffect(() => {
    let cancelled = false
    // Fire both immediately: bootstrap doesn't need config's answer to
    // start, so the probe round-trip comes off the cold-start critical path
    // (in demo mode the bootstrap 503 is simply discarded).
    const bootstrapPromise = liveApi.bootstrap()
    bootstrapPromise.catch(() => undefined)
    liveApi
      .config()
      .then(async (config) => {
        if (cancelled) return
        useOrbit.getState().setLive(config.live, config.userEmail, config.isAdmin)
        if (!config.live) return
        try {
          const bootstrap = await bootstrapPromise
          if (cancelled) return
          hydrateFromBootstrap(bootstrap)
        } catch (error) {
          if (cancelled) return
          // Never leave demo seeds on screen for a live user: fall back to
          // an empty live workspace and surface the failure.
          useOrbit.getState().hydrateLive({
            docs: [],
            folders: [],
            sessions: [],
            sites: [],
            chatFolders: [],
          })
          toast.error("Couldn't reach Foundry", {
            description:
              error instanceof Error ? error.message : "Bootstrap failed",
          })
        }
      })
      .catch(() => useOrbit.getState().setLive(false))
    return () => {
      cancelled = true
    }
  }, [])

  /* poll indexing status while any live docs are pending */
  React.useEffect(() => {
    if (!live) return
    const interval = setInterval(async () => {
      const { docs, updateDoc } = useOrbit.getState()
      const pending = docs.filter((d) => d.status !== "ready" && d.status !== "error")
      if (pending.length === 0) return
      try {
        const { data } = await liveApi.docStatuses(pending.map((d) => d.id))
        for (const status of data) {
          if (status.isIndexed) {
            updateDoc(status.primaryKey, {
              status: "ready",
              pages: status.noPages ?? undefined,
              progress: undefined,
            })
          }
        }
      } catch {
        // transient; next tick retries
      }
    }, DOC_STATUS_POLL_MS)
    return () => clearInterval(interval)
  }, [live])

  if (live === null) return <ConnectingSplash label="Checking your workspace…" />
  if (live === true && !liveHydrated) {
    return <ConnectingSplash label="Loading your documents and sessions from Foundry…" />
  }
  return <>{children}</>
}
