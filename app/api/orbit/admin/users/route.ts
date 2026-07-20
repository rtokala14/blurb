import {
  getDocCensus,
  grantsByEmail,
  listAllUsers,
  serializeAdminUser,
  usageTodayByEmail,
} from "@/lib/foundry/admin"
import { normalizeEmail } from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { requireAdminUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/** User management list with today's usage, grants, and document counts. */
export async function GET(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    await requireAdminUser(request)
    const [users, usage, grants, census] = await Promise.all([
      listAllUsers(),
      usageTodayByEmail(),
      grantsByEmail(),
      getDocCensus(),
    ])
    const data = users
      .map((user) => {
        const email = normalizeEmail(user.email)
        return serializeAdminUser(user, {
          usageToday: usage.get(email) ?? 0,
          grants: grants.get(email) ?? [],
          documents: census.byOwner.get(email),
        })
      })
      .sort((a, b) => a.email.localeCompare(b.email))
    return json({ data, count: data.length })
  } catch (error) {
    return errorResponse(error)
  }
}
