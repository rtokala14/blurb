import { serializeAdminUser, usageTodayByEmail } from "@/lib/foundry/admin"
import { listGrantsForUser, normalizeEmail } from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import {
  getProvisionedUser,
  listAllUsers,
  requireAdminUser,
  updateUserRow,
} from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/**
 * Update a user's flags and rate limit (PUT /api/admin/users/{email}). The
 * edit action is a full replay, so unspecified fields keep their current
 * values.
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
    const targetEmail = normalizeEmail(pk)
    let user = await getProvisionedUser(targetEmail)
    if (!user) {
      const all = await listAllUsers()
      user = all.find((u) => normalizeEmail(u.email) === targetEmail) ?? null
    }
    if (!user) return json({ error: "User not found" }, { status: 404 })

    const body = (await request.json()) as Partial<{
      name: string
      role: "user" | "admin"
      isOnboarded: boolean
      isAllowedToUpload: boolean
      dailyUploadLimit: number
    }>

    // Guardrail: an admin can't demote themselves — prevents locking everyone
    // out.
    const isSelf = normalizeEmail(user.email) === admin.email
    if (isSelf && body.role !== undefined && body.role !== "admin") {
      return json(
        { error: "You can't remove your own admin access" },
        { status: 422 }
      )
    }

    const fields: Parameters<typeof updateUserRow>[1] = {}
    if (body.name !== undefined) fields.name = body.name
    if (body.role !== undefined) fields.role = body.role
    if (body.isOnboarded !== undefined) fields.isOnboarded = body.isOnboarded
    if (body.isAllowedToUpload !== undefined) {
      fields.isAllowedToUpload = body.isAllowedToUpload
    }
    if (body.dailyUploadLimit !== undefined) {
      fields.dailyUploadLimit = body.dailyUploadLimit
    }
    await updateUserRow(user, fields)

    const [fresh, usage, grants] = await Promise.all([
      getProvisionedUser(targetEmail),
      usageTodayByEmail(),
      listGrantsForUser(targetEmail),
    ])
    const row = fresh ?? user
    return json({
      success: true,
      data: serializeAdminUser(row, {
        usageToday: usage.get(targetEmail) ?? 0,
        grants,
      }),
    })
  } catch (error) {
    return errorResponse(error)
  }
}
