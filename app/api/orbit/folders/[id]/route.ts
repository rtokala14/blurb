import {
  deleteFolder,
  editDocRow,
  editFolder,
  getAccessibleFolders,
  getFolder,
  listAccessibleDocs,
  ROOT_FOLDER_ID,
  sameEmail,
  serializeFolder,
  type FolderRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

async function getOwnedFolder(id: string, userEmail: string) {
  const folder = await getFolder(id)
  if (!folder) {
    return { error: json({ error: "Folder not found" }, { status: 404 }) }
  }
  if (!sameEmail(folder.ownerUserId, userEmail)) {
    return {
      error: json(
        { error: "Only the folder owner can modify it" },
        { status: 403 }
      ),
    }
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
      parentId: string | null
      accessEmails: string[]
    }>
    await editFolder(owned.folder as FolderRow, {
      name: body.name,
      parentFolderId: body.parentId === null ? ROOT_FOLDER_ID : body.parentId,
      allowedUserIds: body.accessEmails,
    })
    const updated = await getFolder(id)
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
    const userEmail = await resolveRequestUser(request)
    const owned = await getOwnedFolder(id, userEmail)
    if (owned.error) return owned.error

    const url = new URL(request.url)
    const force = url.searchParams.get("force") === "true"

    const [folders, docsResult] = await Promise.all([
      getAccessibleFolders(userEmail),
      listAccessibleDocs(userEmail),
    ])
    const childFolders = folders.filter((f) => f.parentFolderId === id)
    const childDocs = docsResult.docs.filter((d) => d.parentFolderId === id)

    if ((childFolders.length > 0 || childDocs.length > 0) && !force) {
      return json({ error: "Folder is not empty" }, { status: 409 })
    }

    if (force) {
      // Move contained docs to root and re-parent child folders to root.
      await Promise.all([
        ...childDocs.map((doc) =>
          editDocRow(doc, { parentFolderId: ROOT_FOLDER_ID })
        ),
        ...childFolders.map((folder) =>
          editFolder(folder, { parentFolderId: ROOT_FOLDER_ID })
        ),
      ])
    }

    await deleteFolder(id)
    return json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
