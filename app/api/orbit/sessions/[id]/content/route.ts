import { ensureMainBranch } from "@/lib/foundry/chat"
import {
  getSessionBranches,
  getSessionMessages,
  getSessionRow,
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
    // All three queries are independent — fetch concurrently; nothing is
    // returned unless the ownership check passes.
    const [sessionRow, messages, existingBranches] = await Promise.all([
      getSessionRow(id, userEmail),
      getSessionMessages(id),
      getSessionBranches(id),
    ])
    if (!sessionRow) return json({ error: "Session not found" }, { status: 404 })
    let session = sessionRow
    let branches = existingBranches
    if (branches.length === 0) {
      // legacy session without a main branch — repair (rare, refetches)
      ;({ session, branches } = await ensureMainBranch(sessionRow, userEmail))
    }
    return json(serializeContent(messages, session, branches))
  } catch (error) {
    return errorResponse(error)
  }
}
