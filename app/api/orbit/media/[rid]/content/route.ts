import { getMediaContent } from "@/lib/foundry/client"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

/**
 * Stream a media item (the PDF behind a citation's `<source id="ri.mio…">`).
 * Content is immutable per RID, so allow long private caching.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ rid: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { rid } = await params
    if (!/^ri\.mio\.[a-z-]*\.media-item\.[a-zA-Z0-9-]+$/.test(rid)) {
      return json({ error: "Invalid media item RID" }, { status: 400 })
    }
    const upstream = await getMediaContent(rid)
    if (!upstream.ok || !upstream.body) {
      return json(
        { error: `Media fetch failed (${upstream.status})` },
        { status: upstream.status === 404 ? 404 : 502 }
      )
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/pdf",
        "Cache-Control": "private, max-age=1200",
        "Content-Disposition": "inline",
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
