import {
  getIndexCountsForDocs,
  listAccessibleDocs,
  pk,
  searchAccessibleDocs,
  serializeDoc,
  type DocRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/**
 * Documents list. `?q=` runs an ontology-side term search across the user's
 * whole corpus instead of the newest page.
 */
export async function GET(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const userEmail = await resolveRequestUser(request)
    const url = new URL(request.url)
    const q = (url.searchParams.get("q") ?? "").trim()
    const limitParam = Number(url.searchParams.get("limit"))
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, 2000)
        : undefined

    let docs: DocRow[]
    if (q) {
      docs = await searchAccessibleDocs(userEmail, q, { limit: limit ?? 50 })
    } else {
      const result = await listAccessibleDocs(
        userEmail,
        limit ? { limit } : {}
      )
      docs = result.docs
    }
    const indexCounts = await getIndexCountsForDocs(docs)
    return json({
      data: docs.map((doc) =>
        serializeDoc(doc, {
          indexCounts: indexCounts.get(pk(doc)),
          userEmail,
        })
      ),
      count: docs.length,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
