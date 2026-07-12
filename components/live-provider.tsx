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
import { useOrbit } from "@/lib/store"

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
    sessions: data.sessions.map(mapLiveSession),
    sites,
    chatFolders: (data.chatFolders ?? []).map(mapLiveChatFolder),
  })
}

/**
 * Probes /api/orbit/config once on mount. In live mode, hydrates the store
 * from Foundry in a single bootstrap round-trip and keeps indexing statuses
 * fresh while documents are pending. In demo mode the seeded simulation
 * stays untouched.
 */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const live = useOrbit((s) => s.live)

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
