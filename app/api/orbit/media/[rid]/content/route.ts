import { getMediaContentByReference, searchObjects } from "@/lib/foundry/client"
import { canAccessDoc, type DocRow } from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/**
 * Stream a media item (the PDF behind a citation's `<source id="ri.mio…">`).
 * Resolves the owning DocMeta by mediaItemRid and enforces access.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ rid: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { rid } = await params
    if (!/^ri\.mio\.[a-z-]*\.media-item\.[a-zA-Z0-9-]+$/.test(rid)) {
      return json({ error: "Invalid media item RID" }, { status: 400 })
    }
    const userEmail = await resolveRequestUser(request)
    const rows = await searchObjects<DocRow>("OrbitDocsDocMeta", {
      where: { type: "eq", field: "mediaItemRid", value: rid },
      maxItems: 1,
      pageSize: 1,
    })
    const doc = rows[0]
    if (!doc || !doc.mediaReference || !canAccessDoc(doc, userEmail)) {
      return json({ error: "Media item not found" }, { status: 404 })
    }
    const upstream = await getMediaContentByReference(doc.mediaReference)
    if (!upstream.ok || !upstream.body) {
      return json(
        { error: `Media fetch failed (${upstream.status})` },
        { status: upstream.status === 404 ? 404 : 502 }
      )
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? doc.mime ?? "application/pdf",
        "Cache-Control": "private, max-age=1200",
        "Content-Disposition": "inline",
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
