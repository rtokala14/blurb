import { getMediaContent } from "@/lib/foundry/client"
import {
  extractMediaItemRid,
  getAccessibleFolders,
  getDoc,
  normalizeEmail,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/** Stream a document's PDF (owner or shared-via-folder access, like the PoC). */
export async function GET(
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
      const folders = await getAccessibleFolders(userEmail)
      const shared = folders.some((f) =>
        (f.contents ?? []).some((c) => String(c) === pk)
      )
      if (!shared) return json({ error: "Not allowed" }, { status: 403 })
    }
    const mediaRid = extractMediaItemRid(doc.reference)
    if (!mediaRid) {
      return json({ error: "Document has no media reference" }, { status: 422 })
    }
    const upstream = await getMediaContent(mediaRid)
    if (!upstream.ok || !upstream.body) {
      return json(
        { error: `Media fetch failed (${upstream.status})` },
        { status: 502 }
      )
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, max-age=1200",
        "Content-Disposition": "inline",
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
