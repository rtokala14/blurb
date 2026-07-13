"use client"

import * as React from "react"
import { toast } from "sonner"

import { liveApi, type LiveBootstrap } from "@/lib/live-api"
import {
  mapLiveChatFolder,
  mapLiveDoc,
  mapLiveFolders,
  mapLiveSession,
  mapSyncSources,
} from "@/lib/live-map"
import { sessionPersonaFor, useOrbit } from "@/lib/store"

const DOC_STATUS_POLL_MS = 30_000

/** doc pk -> containing folder id, captured at hydrate for later page loads */
let lastFolderByDocId = new Map<string, string>()

export function hydrateFromBootstrap(data: LiveBootstrap) {
  const { folders, folderByDocId } = mapLiveFolders(data.folders)
  lastFolderByDocId = folderByDocId
  const sync = mapSyncSources(data.syncSources)
  const docs = data.documents.map((doc) => mapLiveDoc(doc, folderByDocId))
  const sites = sync.sites.map((site) => ({
    ...site,
    docCount: docs.filter((d) => d.folderId === site.mappedFolderId).length,
  }))
  useOrbit.getState().hydrateLive({
    docs,
    folders: [...folders, ...sync.folders],
    // restore each session's persona choice from client-side storage (v1)
    sessions: data.sessions.map((s) => {
      const session = mapLiveSession(s)
      return { ...session, personaId: sessionPersonaFor(session.id) }
    }),
    sites,
    chatFolders: (data.chatFolders ?? []).map(mapLiveChatFolder),
  })
}

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

  React.useEffect(() => {
    let cancelled = false
    liveApi
      .config()
      .then(async (config) => {
        if (cancelled) return
        useOrbit.getState().setLive(config.live, config.userEmail, config.isAdmin)
        if (!config.live) return
        try {
          const bootstrap = await liveApi.bootstrap()
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

/**
 * Grow the loaded document window ("Load more" in the library). Refetches
 * the newest `limit` docs and replaces the store's doc list, preserving any
 * locally-adopted extras (search hits, synced files in scope).
 */
export async function loadMoreLiveDocs(limit: number): Promise<number> {
  const { liveApi } = await import("@/lib/live-api")
  const { data } = await liveApi.docs(limit)
  const mapped = data.map((doc) => mapLiveDoc(doc, lastFolderByDocId))
  const store = useOrbit.getState()
  const fetchedIds = new Set(mapped.map((d) => d.id))
  const extras = store.docs.filter((d) => !fetchedIds.has(d.id))
  useOrbit.setState({ docs: [...mapped, ...extras] })
  return mapped.length
}
