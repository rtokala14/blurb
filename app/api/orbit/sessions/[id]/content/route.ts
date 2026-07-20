import {
  getSessionMessages,
  getSessionRow,
  serializeContent,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/** Full message tree plus the active-leaf cursor. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const userEmail = await resolveRequestUser(request)
    const [session, messages] = await Promise.all([
      getSessionRow(id, userEmail),
      getSessionMessages(id),
    ])
    if (!session) return json({ error: "Session not found" }, { status: 404 })
    return json(serializeContent(messages, session))
  } catch (error) {
    return errorResponse(error)
  }
}
