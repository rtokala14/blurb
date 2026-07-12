import { ensureMainBranch } from "@/lib/foundry/chat"
import {
  createBranchRow,
  getSessionMessages,
  getSessionRow,
  pk,
  serializeBranch,
  updateSessionRow,
  type BranchRow,
} from "@/lib/foundry/ontology"
import { getObject } from "@/lib/foundry/client"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

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
    return json({
      activeBranchId: session.activeBranchId ?? null,
      defaultBranchId: session.defaultBranchId ?? null,
      data: branches.map(serializeBranch),
      count: branches.length,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

/** Create a branch anchored at an assistant message and activate it. */
export async function POST(
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
    const body = (await request.json()) as { anchorMessageId?: string; name?: string }
    if (!body.anchorMessageId) {
      return json({ error: "anchorMessageId is required" }, { status: 422 })
    }
    const { branches } = await ensureMainBranch(sessionRow, userEmail)
    const messages = await getSessionMessages(id)
    const anchor = messages.find((m) => pk(m) === body.anchorMessageId)
    if (!anchor) return json({ error: "Anchor message not found" }, { status: 404 })
    if (!anchor.isAgent) {
      return json(
        { error: "Only assistant messages can be used as branch anchors" },
        { status: 422 }
      )
    }

    const existing = new Set(
      branches.map((b) => (b.name ?? "").trim().toLowerCase())
    )
    let name = (body.name ?? "").trim()
    if (!name) {
      let index = 2
      while (existing.has(`branch-${index}`)) index += 1
      name = `branch-${index}`
    }

    const branchId = await createBranchRow({
      sessionId: id,
      createdBy: userEmail,
      name,
      anchorMessageId: body.anchorMessageId,
    })
    await updateSessionRow(id, {
      activeBranchId: branchId,
      updatedAt: new Date().toISOString(),
    })
    const created = await getObject<BranchRow>("OrbitSessionBranches", branchId)
    return json(
      {
        activeBranchId: branchId,
        branch: created ? serializeBranch(created) : { id: branchId, name },
      },
      { status: 201 }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
