import { collectOverview } from "@/lib/foundry/admin"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { requireAdminUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Admin dashboard payload: totals, per-day trends, power users, near-quota
 * users. `includeAdmins` toggles whether admin-owned activity counts toward
 * the numbers.
 */
export async function GET(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    await requireAdminUser(request)
    const url = new URL(request.url)
    // includeSynced is accepted for backwards compatibility but ignored — v3
    // has no synced documents.
    const overview = await collectOverview({
      days: Number(url.searchParams.get("days")) || 30,
      includeAdmins: url.searchParams.get("includeAdmins") === "true",
    })
    return json(overview)
  } catch (error) {
    return errorResponse(error)
  }
}
