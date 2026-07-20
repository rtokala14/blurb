import {
  createSessionRow,
  getSessionRow,
  listSessions,
  sanitizeAttachments,
  serializeSession,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const sessions = await listSessions(await resolveRequestUser(request))
    return json({
      data: sessions.map((s) => serializeSession(s)),
      count: sessions.length,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const userEmail = await resolveRequestUser(request)
    const body = (await request.json().catch(() => ({}))) as {
      docsAttached?: string[]
      foldersAttached?: string[]
    }
    const sanitized = await sanitizeAttachments(
      userEmail,
      body.docsAttached ?? [],
      body.foldersAttached ?? []
    )
    const sessionId = await createSessionRow({
      userEmail,
      options: {
        docsAttached: sanitized.docsAttached,
        foldersAttached: sanitized.foldersAttached,
      },
    })
    const session = await getSessionRow(sessionId, userEmail)
    return json(session ? serializeSession(session, 0) : { rid: sessionId }, {
      status: 201,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
