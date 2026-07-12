import {
  getSourceIndex,
  listChildren,
  requireAccessibleSource,
} from "@/lib/foundry/sync-browse"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/**
 * Direct children (folders + files) of a folder within a sync source —
 * PoC GET /api/sync/sources/{pk}/browse. Backed by a TTL-cached per-source
 * path index so navigation never re-scans the item table.
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
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0)
    const limit = Math.min(
      1000,
      Math.max(1, Number(url.searchParams.get("limit")) || 200)
    )
    const refresh = url.searchParams.get("refresh") === "true"

    const index = await getSourceIndex(id, { force: refresh })
    const { entries, total } = listChildren(index, path, { offset, limit })
    return json({
      path: path.trim().replace(/^\/+|\/+$/g, ""),
      entries,
      total,
      offset,
      limit,
      totalFiles: index.totalFiles,
      totalFolders: index.totalFolders,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
