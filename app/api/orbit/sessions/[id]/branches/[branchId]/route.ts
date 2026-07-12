import {
  foundryUserEmail,
  getSessionBranches,
  getSessionRow,
  pk,
  updateBranchRow,
  updateSessionRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; branchId: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id, branchId } = await params
    const session = await getSessionRow(id, foundryUserEmail())
    if (!session) return json({ error: "Session not found" }, { status: 404 })
    const branches = await getSessionBranches(id)
    const branch = branches.find((b) => pk(b) === branchId)
    if (!branch) return json({ error: "Branch not found" }, { status: 404 })
    const body = (await request.json()) as { name?: string }
    const name = (body.name ?? "").trim()
    if (!name) return json({ error: "name is required" }, { status: 422 })
    await updateBranchRow(branch, { name })
    return json({ id: branchId, name })
  } catch (error) {
    return errorResponse(error)
  }
}

/** Soft-delete a branch, reassigning active/default (PoC semantics). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; branchId: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id, branchId } = await params
    const session = await getSessionRow(id, foundryUserEmail())
    if (!session) return json({ error: "Session not found" }, { status: 404 })
    const branches = await getSessionBranches(id)
    const branch = branches.find((b) => pk(b) === branchId)
    if (!branch) return json({ error: "Branch not found" }, { status: 404 })

    const body = (await request.json().catch(() => ({}))) as {
      replacementBranchId?: string
    }
    const remaining = branches.filter((b) => pk(b) !== branchId)
    let replacementId: string | null = null
    if (remaining.length > 0) {
      if (body.replacementBranchId) {
        const requested = remaining.find((b) => pk(b) === body.replacementBranchId)
        if (!requested) {
          return json({ error: "Replacement branch not found" }, { status: 404 })
        }
        replacementId = body.replacementBranchId
      } else {
        const preferred = remaining.find((b) => b.isDefault) ?? remaining[0]
        replacementId = pk(preferred)
      }
    }

    await updateBranchRow(branch, {
      isDeleted: true,
      isDefault: false,
      deletedAt: new Date().toISOString(),
    })

    if (replacementId === null) {
      await updateSessionRow(id, {
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      return json({
        success: true,
        deletedBranchId: branchId,
        activeBranchId: null,
        defaultBranchId: null,
        deletedSessionId: id,
      })
    }

    const fields: Record<string, unknown> = { updatedAt: new Date().toISOString() }
    if (session.activeBranchId === branchId) fields.activeBranchId = replacementId
    if (session.defaultBranchId === branchId) {
      fields.defaultBranchId = replacementId
      const replacement = remaining.find((b) => pk(b) === replacementId)
      if (replacement) await updateBranchRow(replacement, { isDefault: true })
    }
    if (Object.keys(fields).length > 1) await updateSessionRow(id, fields)

    return json({
      success: true,
      deletedBranchId: branchId,
      activeBranchId:
        (fields.activeBranchId as string | undefined) ??
        session.activeBranchId ??
        null,
      defaultBranchId:
        (fields.defaultBranchId as string | undefined) ??
        session.defaultBranchId ??
        null,
      deletedSessionId: null,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
