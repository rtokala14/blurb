import {
  listSessions,
  sessionOptions,
  updateSessionRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import {
  getProvisionedUser,
  listChatFolders,
  normalizeChatFolderColor,
  resolveRequestUser,
  saveChatFolders,
  serializeChatFolder,
} from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/** Rename / recolor a chat folder. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const userRow = await getProvisionedUser(await resolveRequestUser(request))
    if (!userRow) return json({ error: "User not found" }, { status: 404 })
    const folders = listChatFolders(userRow)
    const existing = folders.find((f) => f.id === id)
    if (!existing) {
      return json({ error: "Chat folder not found" }, { status: 404 })
    }
    const body = (await request.json()) as { name?: string; color?: string }
    const updated = {
      ...existing,
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.color !== undefined
        ? { color: normalizeChatFolderColor(body.color) }
        : {}),
    }
    await saveChatFolders(
      userRow,
      folders.map((f) => (f.id === id ? updated : f))
    )
    return json(serializeChatFolder(updated))
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Delete a chat folder. Member sessions are either soft-deleted with it or
 * unfiled (deleteSessions flag).
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const userEmail = await resolveRequestUser(request)
    const userRow = await getProvisionedUser(userEmail)
    if (!userRow) return json({ error: "User not found" }, { status: 404 })
    const folders = listChatFolders(userRow)
    if (!folders.some((f) => f.id === id)) {
      return json({ error: "Chat folder not found" }, { status: 404 })
    }
    const body = (await request.json().catch(() => ({}))) as {
      deleteSessions?: boolean
    }
    const deleteSessions = Boolean(body.deleteSessions)

    await saveChatFolders(
      userRow,
      folders.filter((f) => f.id !== id)
    )

    const sessions = await listSessions(userEmail)
    const members = sessions.filter(
      (row) => sessionOptions(row).chatFolderId === id
    )
    // Each session is a distinct row, so the updates are independent.
    await Promise.all(
      members.map((row) =>
        deleteSessions
          ? updateSessionRow(row, { isDeleted: true })
          : updateSessionRow(row, { options: { chatFolderId: null } })
      )
    )
    const deleted = deleteSessions ? members.length : 0
    const unfiled = deleteSessions ? 0 : members.length
    return json({
      success: true,
      deletedFolderId: id,
      affectedSessionCount: members.length,
      deletedSessionCount: deleted,
      unfiledSessionCount: unfiled,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
