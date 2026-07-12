import { collectOverview } from "@/lib/foundry/admin"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { requireAdminUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Admin dashboard payload: totals, per-day trends, power users, near-quota
 * users. `includeAdmins` / `includeSynced` toggle whether admin-owned
 * activity and SharePoint-synced documents count toward the numbers.
 */
export async function GET(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    await requireAdminUser(request)
    const url = new URL(request.url)
    const overview = await collectOverview({
      days: Number(url.searchParams.get("days")) || 30,
      includeAdmins: url.searchParams.get("includeAdmins") === "true",
      includeSynced: url.searchParams.get("includeSynced") !== "false",
    })
    return json(overview)
  } catch (error) {
    return errorResponse(error)
  }
}
