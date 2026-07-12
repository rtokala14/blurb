import { getRunStatus } from "@/lib/foundry/chat"
import { foundryUserEmail, getSessionRow } from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

/** Run-state recovery poll — finalizes a completed run whose stream dropped. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const session = await getSessionRow(id, foundryUserEmail())
    if (!session) return json({ error: "Session not found" }, { status: 404 })
    return json(await getRunStatus(session))
  } catch (error) {
    return errorResponse(error)
  }
}
