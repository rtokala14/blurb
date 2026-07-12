import { getObject } from "@/lib/foundry/client"
import {
  deleteFolder,
  editFolder,
  normalizeEmail,
  serializeFolder,
  type FolderRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

async function getOwnedFolder(id: string, userEmail: string) {
  const folder = await getObject<FolderRow>("OrbitFolders", id)
  if (!folder) return { error: json({ error: "Folder not found" }, { status: 404 }) }
  if (normalizeEmail(folder.createdBy) !== normalizeEmail(userEmail)) {
    return { error: json({ error: "Only the folder creator can modify it" }, { status: 403 }) }
  }
  return { folder }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const owned = await getOwnedFolder(id, await resolveRequestUser(request))
    if (owned.error) return owned.error
    const body = (await request.json()) as Partial<{
      name: string
      color: string
      accessEmails: string[]
      contents: string[]
    }>
    await editFolder(id, body)
    const updated = await getObject<FolderRow>("OrbitFolders", id)
    return json(updated ? serializeFolder(updated) : { success: true })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const owned = await getOwnedFolder(id, await resolveRequestUser(request))
    if (owned.error) return owned.error
    await deleteFolder(id)
    return json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
