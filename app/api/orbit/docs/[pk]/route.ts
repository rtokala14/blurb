import {
  getAccessibleFolders,
  getDoc,
  normalizeEmail,
  removeDocFromFolders,
  softDeleteDoc,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/** Soft-delete a document and pull it out of any accessible folders. */
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
    if (!doc || doc.isActive === false) {
      return json({ error: "Document not found" }, { status: 404 })
    }
    if (normalizeEmail(doc.addedBy) !== normalizeEmail(userEmail)) {
      return json({ error: "Not allowed" }, { status: 403 })
    }
    const folders = await getAccessibleFolders(userEmail)
    const removedFromFolders = await removeDocFromFolders(pk, folders)
    await softDeleteDoc(doc)
    return json({ success: true, removedFromFolders })
  } catch (error) {
    return errorResponse(error)
  }
}
