import {
  listAccessibleDocs,
  searchAccessibleDocs,
  serializeDoc,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/**
 * Documents list (PoC GET /api/docs). `?q=` runs an ontology-side term
 * search across the user's whole corpus instead of the newest page.
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

    const result = q
      ? await searchAccessibleDocs(userEmail, q, { limit: limit ?? 50 })
      : await listAccessibleDocs(userEmail, limit ? { limit } : {})
    return json({
      data: result.docs.map((doc) =>
        serializeDoc(doc, {
          sharedFolderNames: result.sharedFolderNames,
          indexStatus: result.indexStatus,
          userEmail,
        })
      ),
      count: result.docs.length,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
