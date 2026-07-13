import { applyAction, getObject } from "@/lib/foundry/client"
import {
  invalidateSyncSourceCache,
  normalizeEmail,
  sameEmail,
  serializeSyncSource,
  type SyncSourceRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Replace a sync source's share list (owner only). Emails are normalized to
 * lowercase; the owner is never stored in sharedWith. Uses the
 * edit-orbit-sync-source action — omitted params are preserved.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const userEmail = await resolveRequestUser(request)
    const source = await getObject<SyncSourceRow>("OrbitSyncSource", id)
    if (!source) return json({ error: "Sync source not found" }, { status: 404 })
    if (!sameEmail(source.ownerEmail, userEmail)) {
      return json(
        { error: "Only the sync source owner can manage sharing" },
        { status: 403 }
      )
    }

    const body = (await request.json()) as { sharedWith?: unknown }
    if (!Array.isArray(body.sharedWith)) {
      return json({ error: "sharedWith must be an array of emails" }, { status: 422 })
    }
    const sharedWith = [
      ...new Set(
        body.sharedWith
          .map((e) => normalizeEmail(String(e)))
          .filter((e) => e && !sameEmail(e, userEmail))
      ),
    ]
    const invalid = sharedWith.filter((e) => !EMAIL_RE.test(e))
    if (invalid.length > 0) {
      return json(
        { error: `Invalid email${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}` },
        { status: 422 }
      )
    }

    await applyAction("edit-orbit-sync-source", {
      OrbitSyncSource: id,
      sharedWith,
    })
    invalidateSyncSourceCache()
    const updated = await getObject<SyncSourceRow>("OrbitSyncSource", id)
    return json({
      success: true,
      sharedWith: updated ? serializeSyncSource(updated).sharedWith : sharedWith,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
