import { ensureMainBranch } from "@/lib/foundry/chat"
import {
  getSessionMessages,
  getSessionRow,
  pk,
  serializeContent,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/** Active-branch transcript plus the branch list (PoC /content). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const userEmail = await resolveRequestUser(request)
    const sessionRow = await getSessionRow(id, userEmail)
    if (!sessionRow) return json({ error: "Session not found" }, { status: 404 })
    const { session, branches } = await ensureMainBranch(sessionRow, userEmail)
    const messages = await getSessionMessages(pk(session))
    return json(serializeContent(messages, session, branches))
  } catch (error) {
    return errorResponse(error)
  }
}
