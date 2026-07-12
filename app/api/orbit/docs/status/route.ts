import { getObjectsByIds } from "@/lib/foundry/client"
import { getIndexStatusMap, type DocRow } from "@/lib/foundry/ontology"
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

    const [docs, statusMap] = await Promise.all([
      getObjectsByIds<DocRow>("OrbitDocsList", "primaryKey_", primaryKeys),
      getIndexStatusMap(),
    ])
    const data = primaryKeys
      .map((key) => {
        const doc = docs.get(key)
        if (!doc) return null
        const status = statusMap.get(key)
        return {
          primaryKey: key,
          isIndexed: status?.isIndexingComplete ?? Boolean(doc.isIndexed),
          noPages: status?.noPages ?? doc.noPages ?? null,
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
