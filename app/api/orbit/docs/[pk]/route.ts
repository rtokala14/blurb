import {
  deleteDocRow,
  editDocRow,
  getDoc,
  ROOT_FOLDER_ID,
  sameEmail,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/** Hard-delete a document (owner only). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ pk: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { pk } = await params
    const userEmail = await resolveRequestUser(request)
    const doc = await getDoc(pk)
    if (!doc) return json({ error: "Document not found" }, { status: 404 })
    if (!sameEmail(doc.userEmail, userEmail)) {
      return json({ error: "Not allowed" }, { status: 403 })
    }
    await deleteDocRow(pk)
    return json({ success: true, removedFromFolders: 0 })
  } catch (error) {
    return errorResponse(error)
  }
}

/** Move a document between folders and/or update its sharing (owner only). */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ pk: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { pk } = await params
    const userEmail = await resolveRequestUser(request)
    const doc = await getDoc(pk)
    if (!doc) return json({ error: "Document not found" }, { status: 404 })
    if (!sameEmail(doc.userEmail, userEmail)) {
      return json({ error: "Not allowed" }, { status: 403 })
    }
    const body = (await request.json()) as Partial<{
      folderId: string | null
      allowedUserIds: string[]
    }>
    await editDocRow(doc, {
      ...(body.folderId !== undefined
        ? { parentFolderId: body.folderId ?? ROOT_FOLDER_ID }
        : {}),
      ...(body.allowedUserIds !== undefined
        ? { allowedUserIds: body.allowedUserIds }
        : {}),
    })
    return json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
