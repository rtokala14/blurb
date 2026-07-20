import { getMediaContentByReference } from "@/lib/foundry/client"
import { canAccessDoc, getDoc } from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/** Stream a document's PDF (owner or shared access). */
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
    if (!doc) return json({ error: "Document not found" }, { status: 404 })
    if (!canAccessDoc(doc, userEmail)) {
      return json({ error: "Not allowed" }, { status: 403 })
    }
    if (!doc.mediaReference) {
      return json({ error: "Document has no media reference" }, { status: 422 })
    }
    const upstream = await getMediaContentByReference(doc.mediaReference)
    if (!upstream.ok || !upstream.body) {
      return json(
        { error: `Media fetch failed (${upstream.status})` },
        { status: 502 }
      )
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": doc.mime ?? "application/pdf",
        "Cache-Control": "private, max-age=1200",
        "Content-Disposition": "inline",
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
