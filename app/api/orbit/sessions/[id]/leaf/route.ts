import {
  getSessionMessages,
  getSessionRow,
  pk,
  updateSessionRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/** Repoint the session's active leaf — powers branch switching. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const userEmail = await resolveRequestUser(request)
    const session = await getSessionRow(id, userEmail)
    if (!session) return json({ error: "Session not found" }, { status: 404 })
    const body = (await request.json()) as { messageId?: string }
    const messageId = (body.messageId ?? "").trim()
    const messages = await getSessionMessages(id)
    if (!messageId || !messages.some((m) => pk(m) === messageId)) {
      return json({ error: "Message not found" }, { status: 404 })
    }
    await updateSessionRow(session, { activeLeafMessageId: messageId })
    return json({ success: true, activeLeafMessageId: messageId })
  } catch (error) {
    return errorResponse(error)
  }
}
