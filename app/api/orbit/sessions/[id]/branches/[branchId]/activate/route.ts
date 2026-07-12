import {
  foundryUserEmail,
  getSessionBranches,
  getSessionRow,
  pk,
  updateSessionRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; branchId: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id, branchId } = await params
    const session = await getSessionRow(id, foundryUserEmail())
    if (!session) return json({ error: "Session not found" }, { status: 404 })
    const branches = await getSessionBranches(id)
    if (!branches.some((b) => pk(b) === branchId)) {
      return json({ error: "Branch not found" }, { status: 404 })
    }
    await updateSessionRow(id, {
      activeBranchId: branchId,
      updatedAt: new Date().toISOString(),
    })
    return json({ success: true, activeBranchId: branchId })
  } catch (error) {
    return errorResponse(error)
  }
}
