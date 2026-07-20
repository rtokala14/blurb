import {
  getSessionRow,
  serializeSession,
  updateSessionRow,
} from "@/lib/foundry/ontology"
import { normalizeTitle } from "@/lib/foundry/turn"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const session = await getSessionRow(id, await resolveRequestUser(request))
    if (!session) return json({ error: "Session not found" }, { status: 404 })
    const body = (await request.json()) as { title?: string }
    const title = normalizeTitle(body.title ?? "")
    await updateSessionRow(session, { title })
    return json(serializeSession({ ...session, title }))
  } catch (error) {
    return errorResponse(error)
  }
}
