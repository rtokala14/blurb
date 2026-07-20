import { getObject } from "@/lib/foundry/client"
import {
  getChatFolder,
  listSessionsInChatFolder,
  normalizeEmail,
  pk,
  serializeChatFolder,
  softDeleteChatFolder,
  updateChatFolder,
  updateSessionRow,
  type ChatFolderRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

async function getOwnedChatFolder(id: string, userEmail: string) {
  const folder = await getChatFolder(id)
  if (!folder) {
    return { error: json({ error: "Chat folder not found" }, { status: 404 }) }
  }
  if (normalizeEmail(folder.createdBy) !== normalizeEmail(userEmail)) {
    return {
      error: json(
        { error: "Only the folder creator can modify it" },
        { status: 403 }
      ),
    }
  }
  return { folder }
}

/** Rename / recolor (PoC PUT /api/chat-folders/{id}). */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const owned = await getOwnedChatFolder(id, await resolveRequestUser(request))
    if (owned.error) return owned.error
    const body = (await request.json()) as { name?: string; color?: string | null }
    await updateChatFolder(owned.folder, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
    })
    const updated = await getObject<ChatFolderRow>("OrbitChatFolders", id)
    return json(updated ? serializeChatFolder(updated) : { success: true })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Soft-delete the folder; member sessions are either soft-deleted with it
 * or unfiled (PoC DELETE /api/chat-folders/{id} with deleteSessions flag).
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const owned = await getOwnedChatFolder(id, await resolveRequestUser(request))
    if (owned.error) return owned.error
    const body = (await request.json().catch(() => ({}))) as {
      deleteSessions?: boolean
    }
    const deleteSessions = Boolean(body.deleteSessions)

    const sessions = await listSessionsInChatFolder(id)
    const timestamp = new Date().toISOString()
    // Each session is a distinct row, so the updates are independent — fan
    // them out concurrently instead of awaiting one write at a time.
    await Promise.all(
      sessions.map((session) =>
        deleteSessions
          ? updateSessionRow(pk(session), {
              isDeleted: true,
              deletedAt: timestamp,
              updatedAt: timestamp,
            })
          : // explicit null clears the assignment (omitted params are preserved)
            updateSessionRow(pk(session), {
              chatFolderId: null,
              updatedAt: timestamp,
            })
      )
    )
    const deleted = deleteSessions ? sessions.length : 0
    const unfiled = deleteSessions ? 0 : sessions.length
    await softDeleteChatFolder(owned.folder)
    return json({
      success: true,
      deletedFolderId: id,
      affectedSessionCount: sessions.length,
      deletedSessionCount: deleted,
      unfiledSessionCount: unfiled,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
