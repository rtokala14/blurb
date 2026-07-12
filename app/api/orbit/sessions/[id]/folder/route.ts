import {
  foundryUserEmail,
  getChatFolder,
  getSessionRow,
  normalizeEmail,
  updateSessionRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

/**
 * File a session into a chat folder, or unfile it with folderId: null
 * (PoC PUT /api/sessions/{id}/folder).
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const userEmail = foundryUserEmail()
    const session = await getSessionRow(id, userEmail)
    if (!session) return json({ error: "Session not found" }, { status: 404 })

    const body = (await request.json()) as { folderId?: string | null }
    const folderId = body.folderId ?? null
    if (folderId !== null) {
      const folder = await getChatFolder(folderId)
      if (!folder) {
        return json({ error: "Chat folder not found" }, { status: 404 })
      }
      if (normalizeEmail(folder.createdBy) !== normalizeEmail(userEmail)) {
        return json({ error: "Access denied to this folder" }, { status: 403 })
      }
    }
    await updateSessionRow(id, {
      chatFolderId: folderId,
      updatedAt: new Date().toISOString(),
    })
    return json({ success: true, folderId })
  } catch (error) {
    return errorResponse(error)
  }
}
