import { getSessionTrace } from "@/lib/foundry/client"
import { foundryUserEmail, getSessionRow } from "@/lib/foundry/ontology"
import { summarizeTrace } from "@/lib/foundry/turn"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

/**
 * High-level thinking-trace poll for the in-flight run. Returns only the
 * summarized steps (tool label + the agent's one-line thought) — raw tool
 * inputs/outputs never leave the server. Read-only: unlike /run it never
 * finalizes the run, so it is safe to poll while the stream is open.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const session = await getSessionRow(id, foundryUserEmail())
    if (!session) return json({ error: "Session not found" }, { status: 404 })

    const { currentAgentRid, currentSessionId, currentSessionTraceId } = session
    if (!currentAgentRid || !currentSessionId || !currentSessionTraceId) {
      return json({ status: "idle", steps: [] })
    }
    // A client polling for a specific turn passes its trace id; until the
    // session row carries it, the run hasn't registered yet — report pending
    // instead of leaking the previous turn's trace.
    const requestedTraceId = new URL(request.url).searchParams.get("traceId")
    if (requestedTraceId && requestedTraceId !== currentSessionTraceId) {
      return json({ status: "pending", steps: [] })
    }
    const trace = await getSessionTrace(
      currentAgentRid,
      currentSessionId,
      currentSessionTraceId
    )
    if (!trace) return json({ status: "unknown", steps: [] })
    return json({ status: trace.status ?? "unknown", steps: summarizeTrace(trace) })
  } catch (error) {
    return errorResponse(error)
  }
}
