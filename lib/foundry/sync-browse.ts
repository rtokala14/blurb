import "server-only"

import { searchObjects } from "./client"
import {
  buildIndexFromRows,
  descendantDocPks,
  listChildren,
  searchIndex,
  type SourceIndex,
  type SyncItemRow,
} from "./sync-index"

/**
 * Folder-explorer browsing & search over Orbit Sync items — port of the
 * PoC's services/sync_browse.py.
 *
 * Orbit Sync registers one OrbitSyncItem per file/folder, keyed by a
 * forward-slash `sourceItemKey` relative to the source root. The ontology
 * can't answer "direct children of path P" queries, so we build a compact
 * in-memory path index per source (TTL-cached, single-flight) and answer
 * navigation/search from it instantly.
 */

const INDEX_TTL_MS = 300_000

const indexCache = new Map<string, { at: number; index: SourceIndex }>()
const indexInFlight = new Map<string, Promise<SourceIndex>>()

async function buildIndex(sourcePk: string): Promise<SourceIndex> {
  const rows = await searchObjects<SyncItemRow>("OrbitSyncItem", {
    where: { type: "eq", field: "sourceSyncConfigPk", value: sourcePk },
    select: ["sourceItemKey", "itemType", "orbitObjectPk", "syncStatus"],
    pageSize: 10_000,
    maxItems: 200_000,
  })
  return buildIndexFromRows(rows)
}

export async function getSourceIndex(
  sourcePk: string,
  { force = false }: { force?: boolean } = {}
): Promise<SourceIndex> {
  if (!force) {
    const cached = indexCache.get(sourcePk)
    if (cached && Date.now() - cached.at < INDEX_TTL_MS) return cached.index
    const inFlight = indexInFlight.get(sourcePk)
    if (inFlight) return inFlight
  }
  const promise = buildIndex(sourcePk)
    .then((index) => {
      indexCache.set(sourcePk, { at: Date.now(), index })
      return index
    })
    .finally(() => indexInFlight.delete(sourcePk))
  indexInFlight.set(sourcePk, promise)
  return promise
}

/** Owned-or-shared guard for the explorer routes (PoC _resolve_source_or_403). */
export async function requireAccessibleSource(sourceId: string, userEmail: string) {
  const { listSyncSources, pk } = await import("./ontology")
  const sources = await listSyncSources(userEmail)
  return sources.find((s) => pk(s) === sourceId) ?? null
}

export { descendantDocPks, listChildren, searchIndex }
export type { SourceIndex }
