import type { LiveBootstrap } from "@/lib/live-api"
import {
  mapLiveChatFolder,
  mapLiveDoc,
  mapLiveFolders,
  mapLiveSession,
  mapSyncSources,
} from "@/lib/live-map"
import { useOrbit } from "@/lib/store"

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
