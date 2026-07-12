import {
  getSourceIndex,
  requireAccessibleSource,
  searchIndex,
} from "@/lib/foundry/sync-browse"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/**
 * Search files/folders within a sync source by name or path substring —
 * PoC GET /api/sync/sources/{pk}/search. Runs over the in-memory path
 * index (complete + exact), not the ontology's fuzzy full-text ranker.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    if (!(await requireAccessibleSource(id, await resolveRequestUser(request)))) {
      return json({ error: "Sync source not found" }, { status: 404 })
    }
    const url = new URL(request.url)
    const q = (url.searchParams.get("q") ?? "").trim()
    const limit = Math.min(
      500,
      Math.max(1, Number(url.searchParams.get("limit")) || 100)
    )
    if (!q) {
      return json({
        path: "",
        entries: [],
        total: 0,
        offset: 0,
        limit,
        totalFiles: 0,
        totalFolders: 0,
      })
    }
    const index = await getSourceIndex(id)
    const entries = searchIndex(index, q, limit)
    return json({
      path: "",
      entries,
      total: entries.length,
      offset: 0,
      limit,
      totalFiles: entries.filter((e) => !e.isFolder).length,
      totalFolders: entries.filter((e) => e.isFolder).length,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
