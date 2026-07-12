import { applyAction, getObject } from "@/lib/foundry/client"
import { serializeAdminUser, usageTodayByEmail } from "@/lib/foundry/admin"
import { normalizeEmail } from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import {
  invalidateUserCache,
  requireAdminUser,
  type OrbitUserRow,
} from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/**
 * Update a user's flags and rate limits (PoC PUT /api/admin/users/{email}).
 * The edit action is a full replay, so unspecified fields keep their
 * current values.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ pk: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const admin = await requireAdminUser(request)
    const { pk } = await params
    const user = await getObject<OrbitUserRow>("OrbitDocsUser", pk)
    if (!user) return json({ error: "User not found" }, { status: 404 })

    const body = (await request.json()) as Partial<{
      name: string
      isAdmin: boolean
      isActive: boolean
      hasUnlimitedUploads: boolean
      dailyUploadLimit: number
      bonusUploadLimit: number
      bonusExpiresAt: string | null
      bonusReason: string | null
    }>

    // Guardrail: an admin can't strip their own admin flag or deactivate
    // themselves — prevents locking everyone out.
    const isSelf = normalizeEmail(user.email) === admin.email
    if (isSelf && (body.isAdmin === false || body.isActive === false)) {
      return json(
        { error: "You can't remove your own admin access or deactivate yourself" },
        { status: 422 }
      )
    }

    const timestamp = new Date().toISOString()
    const touchesBonus =
      body.bonusUploadLimit !== undefined ||
      body.bonusExpiresAt !== undefined ||
      body.bonusReason !== undefined
    await applyAction("edit-orbit-docs-user", {
      OrbitDocsUser: pk,
      name: body.name ?? user.name ?? "",
      isAdmin: body.isAdmin ?? Boolean(user.isAdmin),
      isActive: body.isActive ?? user.isActive !== false,
      featureFlags: user.featureFlags ?? [],
      hasUnlimitedUploads: body.hasUnlimitedUploads ?? Boolean(user.hasUnlimitedUploads),
      dailyUploadLimit: body.dailyUploadLimit ?? Number(user.dailyUploadLimit ?? 0),
      bonusUploadLimit: body.bonusUploadLimit ?? Number(user.bonusUploadLimit ?? 0),
      bonusExpiresAt:
        body.bonusExpiresAt !== undefined
          ? (body.bonusExpiresAt ?? undefined)
          : user.bonusExpiresAt,
      bonusReason:
        body.bonusReason !== undefined
          ? (body.bonusReason ?? undefined)
          : user.bonusReason,
      ...(touchesBonus
        ? { bonusUpdatedAt: timestamp, bonusUpdatedBy: admin.email }
        : {}),
      updatedAt: timestamp,
    })
    invalidateUserCache(user.email)

    const [updated, usage] = await Promise.all([
      getObject<OrbitUserRow>("OrbitDocsUser", pk),
      usageTodayByEmail(),
    ])
    return json({
      success: true,
      data: updated
        ? serializeAdminUser(
            updated,
            usage.get(normalizeEmail(updated.email)) ?? 0
          )
        : null,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
