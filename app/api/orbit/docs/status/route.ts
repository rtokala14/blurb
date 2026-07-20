import {
  canAccessDoc,
  getDocsByIds,
  getIndexCountsForDocs,
  normalizeEmail,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/** Indexing status poll for pending documents. */
export async function POST(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const body = (await request.json().catch(() => ({}))) as {
      primaryKeys?: string[]
    }
    const primaryKeys = (body.primaryKeys ?? []).flatMap((k) => {
      const key = String(k)
      return key ? [key] : []
    })
    if (primaryKeys.length === 0) return json({ data: [], count: 0 })

    const email = normalizeEmail(await resolveRequestUser(request))
    /* Docs first: the counts lookup needs each doc's mediaItemRid to resolve
       pipeline-keyed status rows (see getIndexCountsForDocs). */
    const docs = await getDocsByIds(primaryKeys)
    const indexCounts = await getIndexCountsForDocs([...docs.values()])

    const data = primaryKeys.flatMap((key) => {
      const doc = docs.get(key)
      if (!doc || !canAccessDoc(doc, email)) return []
      const counts = indexCounts.get(key)
      const chunkCount = counts?.chunkCount ?? 0
      const entityCount = counts?.entityCount ?? 0
      const noPages = counts?.pageCount ?? null
      const isIndexed = chunkCount > 0
      return [
        {
          primaryKey: key,
          isIndexed,
          noPages,
          indexStatus: {
            isIndexingComplete: isIndexed,
            embeddingCount: chunkCount,
            entityCount,
            kgReady: entityCount > 0,
            lastUpdated: null as string | null,
            noPages,
          },
        },
      ]
    })
    return json({ data, count: data.length })
  } catch (error) {
    return errorResponse(error)
  }
}
