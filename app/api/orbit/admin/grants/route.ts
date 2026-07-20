import {
  createGrantRow,
  listAllGrants,
  normalizeEmail,
  serializeGrant,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { requireAdminUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/** List all rate-limit grants (admin only). */
export async function GET(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    await requireAdminUser(request)
    const grants = await listAllGrants()
    return json({ data: grants.map(serializeGrant), count: grants.length })
  } catch (error) {
    return errorResponse(error)
  }
}

/** Grant bonus uploads to a user (admin only). */
export async function POST(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const admin = await requireAdminUser(request)
    const body = (await request.json()) as {
      userEmail?: string
      bonusUploads?: number
      validUntil?: string
      validFrom?: string
      reason?: string
    }

    const userEmail = normalizeEmail(body.userEmail)
    if (!userEmail) {
      return json({ error: "userEmail is required" }, { status: 422 })
    }
    const bonusUploads = Number(body.bonusUploads)
    if (!Number.isInteger(bonusUploads) || bonusUploads <= 0) {
      return json(
        { error: "bonusUploads must be a positive integer" },
        { status: 422 }
      )
    }
    if (!body.validUntil || Number.isNaN(Date.parse(body.validUntil))) {
      return json(
        { error: "validUntil must be a valid ISO timestamp" },
        { status: 422 }
      )
    }
    const validFrom =
      body.validFrom && !Number.isNaN(Date.parse(body.validFrom))
        ? body.validFrom
        : new Date().toISOString()

    const primaryKey = await createGrantRow({
      userEmail,
      bonusUploads,
      validFrom,
      validUntil: body.validUntil,
      reason: body.reason ?? "",
      createdBy: admin.email,
    })
    return json({ success: true, primaryKey }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
