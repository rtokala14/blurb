import {
  foundryUserEmail,
  getSessionRow,
  serializeSession,
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
    return json(serializeSession(session))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const session = await getSessionRow(id, foundryUserEmail())
    if (!session) return json({ error: "Session not found" }, { status: 404 })
    await updateSessionRow(id, {
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    return json({ success: true, deletedSessionId: id })
  } catch (error) {
    return errorResponse(error)
  }
}
