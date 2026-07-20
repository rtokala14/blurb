import { getSessionRow, updateSessionRow } from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import {
  getProvisionedUser,
  listChatFolders,
  resolveRequestUser,
} from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/**
 * File a session into a chat folder, or unfile it with folderId: null.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const userEmail = await resolveRequestUser(request)
    const session = await getSessionRow(id, userEmail)
    if (!session) return json({ error: "Session not found" }, { status: 404 })

    const body = (await request.json()) as { folderId?: string | null }
    const folderId = body.folderId ?? null
    if (folderId !== null) {
      const userRow = await getProvisionedUser(userEmail)
      const folders = userRow ? listChatFolders(userRow) : []
      if (!folders.some((f) => f.id === folderId)) {
        return json({ error: "Chat folder not found" }, { status: 404 })
      }
    }
    await updateSessionRow(session, { options: { chatFolderId: folderId } })
    return json({ success: true, folderId })
  } catch (error) {
    return errorResponse(error)
  }
}
