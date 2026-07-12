import { getFoundryConfig } from "@/lib/foundry/config"
import {
  createSessionRow,
  foundryUserEmail,
  listSessions,
  sanitizeAttachments,
  serializeSession,
} from "@/lib/foundry/ontology"
import { normalizeMode, THINKING_MODE } from "@/lib/foundry/turn"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

export async function GET() {
  const guard = requireLive()
  if (guard) return guard
  try {
    const sessions = await listSessions(foundryUserEmail())
    return json({ data: sessions.map((s) => serializeSession(s)), count: sessions.length })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const body = (await request.json().catch(() => ({}))) as {
      mode?: string
      docsAttached?: string[]
      foldersAttached?: string[]
    }
    const userEmail = foundryUserEmail()
    const mode = normalizeMode(body.mode)
    const sanitized = await sanitizeAttachments(
      userEmail,
      body.docsAttached ?? [],
      body.foldersAttached ?? []
    )
    const cfg = getFoundryConfig()
    const session = await createSessionRow({
      userEmail,
      mode,
      docsAttached: sanitized.docsAttached,
      foldersAttached: sanitized.foldersAttached,
      agentRid: mode === THINKING_MODE ? cfg.agents.thinking : cfg.agents.primary,
    })
    return json(serializeSession(session, 0), { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
