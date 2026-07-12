import {
  descendantDocPks,
  getSourceIndex,
  requireAccessibleSource,
} from "@/lib/foundry/sync-browse"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/**
 * Every indexed document pk under a folder (recursively) — PoC
 * GET /api/sync/sources/{pk}/folder-docs. Lets the UI select a whole
 * folder for the AI in one action; empty path = the whole source.
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
    const path = url.searchParams.get("path") ?? ""
    const index = await getSourceIndex(id)
    const docPks = descendantDocPks(index, path)
    return json({
      path: path.trim().replace(/^\/+|\/+$/g, ""),
      docPks,
      count: docPks.length,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
