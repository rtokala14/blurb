import { listAllSessions } from "@/lib/foundry/admin"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { requireAdminUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/** Recent sessions across every user (PoC GET /api/admin/sessions). */
export async function GET(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    await requireAdminUser(request)
    const url = new URL(request.url)
    const limit = Math.min(500, Math.max(10, Number(url.searchParams.get("limit")) || 200))
    const data = await listAllSessions(limit)
    return json({ data, count: data.length })
  } catch (error) {
    return errorResponse(error)
  }
}
