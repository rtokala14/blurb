import { getObjectsByIds } from "@/lib/foundry/client"
import {
  foundryUserEmail,
  getAccessibleFolders,
  getIndexStatusMap,
  normalizeEmail,
  type DocRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

/** Indexing status poll for pending documents (PoC POST /api/docs/status). */
export async function POST(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const body = (await request.json().catch(() => ({}))) as {
      primaryKeys?: string[]
    }
    const primaryKeys = (body.primaryKeys ?? []).map(String).filter(Boolean)
    if (primaryKeys.length === 0) return json({ data: [], count: 0 })

    const user = normalizeEmail(foundryUserEmail())
    const [docs, statusMap, folders] = await Promise.all([
      getObjectsByIds<DocRow>("OrbitDocsList", "primaryKey_", primaryKeys),
      getIndexStatusMap(),
      getAccessibleFolders(user),
    ])
    const folderDocIds = new Set<string>()
    for (const folder of folders) {
      for (const docId of folder.contents ?? []) folderDocIds.add(String(docId))
    }

    // PoC visibility rules: only active docs the user owns or can reach
    // through an accessible folder get a status update.
    const data = primaryKeys
      .map((key) => {
        const doc = docs.get(key)
        if (!doc || doc.isActive === false) return null
        if (normalizeEmail(doc.addedBy) !== user && !folderDocIds.has(key)) {
          return null
        }
        const status = statusMap.get(key)
        return {
          primaryKey: key,
          isIndexed: status?.isIndexingComplete ?? Boolean(doc.isIndexed),
          noPages: doc.noPages ?? status?.noPages ?? null,
          indexStatus: status
            ? {
                isIndexingComplete: Boolean(status.isIndexingComplete),
                embeddingCount: status.embeddingCount ?? null,
                lastUpdated: status.lastUpdated ?? null,
                noPages: status.noPages ?? null,
              }
            : null,
        }
      })
      .filter(Boolean)
    return json({ data, count: data.length })
  } catch (error) {
    return errorResponse(error)
  }
}
