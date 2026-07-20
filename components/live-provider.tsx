"use client"

import * as React from "react"

import { liveApi } from "@/lib/live-api"
import { useOrbit } from "@/lib/store"
import { hydrateFromBootstrap } from "@/components/live-hydrate"
import { OrbitMark } from "@/components/orbit-mark"

const DOC_STATUS_POLL_MS = 30_000

/**
 * Full-screen gate shown while the user identity + bootstrap resolve.
 */
function ConnectingSplash() {
  return (
    <div className="bg-background fixed inset-0 z-50 flex flex-col items-center justify-center">
      <div className="flex items-center gap-3">
        <div className="text-primary size-12">
          <OrbitMark animated title="Orbit Docs" />
        </div>
        <p
          className="text-xl leading-tight font-bold tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Orbit Docs
        </p>
      </div>
    </div>
  )
}

function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <div className="bg-background fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-destructive flex size-12 items-center justify-center rounded-xl border">
        <svg viewBox="0 0 24 24" fill="none" className="size-6" aria-hidden>
          <path
            d="M12 8v5M12 16h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="space-y-1">
        <p className="text-lg font-semibold tracking-tight">
          Can&apos;t reach Foundry
        </p>
        <p className="text-muted-foreground max-w-md text-sm">{message}</p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
      >
        Retry
      </button>
    </div>
  )
}

/**
 * Probes /api/orbit/config once on mount, then hydrates the store from
 * Foundry in a single bootstrap round-trip and keeps indexing statuses fresh
 * while documents are pending. The app is live-only: if Foundry is
 * unconfigured or unreachable, a hard error screen is shown (no demo mode).
 */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const ready = useOrbit((s) => s.ready)
  const configError = useOrbit((s) => s.configError)

  // Restore the per-user profile/persona from localStorage once on the client.
  React.useEffect(() => {
    useOrbit.getState().hydrateUserProfile()
  }, [])

  React.useEffect(() => {
    let cancelled = false
    // Fire both immediately: bootstrap doesn't need config's answer to start,
    // so the probe round-trip comes off the cold-start critical path.
    const bootstrapPromise = liveApi.bootstrap()
    bootstrapPromise.catch(() => undefined)
    liveApi
      .config()
      .then(async (config) => {
        if (cancelled) return
        if (!config.live) {
          useOrbit
            .getState()
            .setConfigError(
              "Foundry credentials are not configured for this deployment."
            )
          return
        }
        useOrbit
          .getState()
          .setIdentity(config.userEmail, Boolean(config.isAdmin))
        try {
          const bootstrap = await bootstrapPromise
          if (cancelled) return
          hydrateFromBootstrap(bootstrap)
        } catch (error) {
          if (cancelled) return
          useOrbit
            .getState()
            .setConfigError(
              error instanceof Error ? error.message : "Bootstrap failed"
            )
        }
      })
      .catch((error) => {
        if (cancelled) return
        useOrbit
          .getState()
          .setConfigError(
            error instanceof Error ? error.message : "Couldn't reach Foundry"
          )
      })
    return () => {
      cancelled = true
    }
  }, [])

  /* poll indexing status while any docs are pending */
  React.useEffect(() => {
    if (!ready || configError) return
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
  }, [ready, configError])

  if (configError) return <ConfigErrorScreen message={configError} />
  if (!ready) {
    return <ConnectingSplash />
  }
  return <>{children}</>
}
