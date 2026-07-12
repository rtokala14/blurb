import {
  foundryUserEmail,
  getSessionRow,
  sanitizeAttachments,
  updateSessionRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

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
    return json({
      docsAttached: (session.docsAttached ?? []).map(String),
      foldersAttached: (session.foldersAttached ?? []).map(String),
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const userEmail = foundryUserEmail()
    const session = await getSessionRow(id, userEmail)
    if (!session) return json({ error: "Session not found" }, { status: 404 })
    const body = (await request.json()) as {
      docsAttached?: string[]
      foldersAttached?: string[]
    }
    const sanitized = await sanitizeAttachments(
      userEmail,
      body.docsAttached ?? [],
      body.foldersAttached ?? []
    )
    await updateSessionRow(id, {
      docsAttached: sanitized.docsAttached,
      foldersAttached: sanitized.foldersAttached,
      updatedAt: new Date().toISOString(),
    })
    return json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
