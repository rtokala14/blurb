import "server-only"

import { countObjects } from "./client"
import {
  activeBonusUploads,
  emailWhere,
  listGrantsForUser,
  normalizeEmail,
} from "./ontology"
import {
  isAdminUser,
  UserResolutionError,
  userDailyLimit,
  type OrbitUserRow,
} from "./user"

/**
 * v3 daily upload quota. There is no usage object anymore:
 *   effective = user.dailyUploadLimit + Σ active RateLimitGrant.bonusUploads
 *   usedToday = count(OrbitDocsDocMeta where userEmail == me AND uploadTs ≥ UTC midnight)
 *   allow iff user.isAllowedToUpload && usedToday + requested ≤ effective
 * Admins are exempt.
 */

export class UploadQuotaExceeded extends UserResolutionError {
  constructor(
    public readonly detail: {
      effectiveLimit: number
      uploadsUsedToday: number
      requestedUploads: number
      remainingUploads: number
    }
  ) {
    super(
      detail.remainingUploads <= 0
        ? `Daily upload limit reached — ${detail.uploadsUsedToday} of ${detail.effectiveLimit} uploads used today. Try again tomorrow, or ask an admin to raise your limit.`
        : `Not enough upload quota left today — ${detail.remainingUploads} remaining of ${detail.effectiveLimit}, but ${detail.requestedUploads} requested. Upload fewer files or ask an admin to raise your limit.`,
      429
    )
    this.name = "UploadQuotaExceeded"
  }
}

export class UploadNotAllowed extends UserResolutionError {
  constructor() {
    super(
      "Uploads are not enabled for your account yet. Ask an admin to enable uploading.",
      403
    )
    this.name = "UploadNotAllowed"
  }
}

export function startOfTodayUtc(): string {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).toISOString()
}

/** Effective daily limit (base + active grants). null = unlimited (admin). */
export async function effectiveDailyLimit(
  user: OrbitUserRow
): Promise<number | null> {
  if (isAdminUser(user)) return null
  const grants = await listGrantsForUser(normalizeEmail(user.email))
  return userDailyLimit(user) + activeBonusUploads(grants)
}

/** Documents this user registered since UTC midnight. */
export async function getUploadsUsedToday(email: string): Promise<number> {
  const counts = await countObjects("OrbitDocsDocMeta", {
    where: {
      type: "and",
      value: [
        emailWhere("userEmail", email),
        { type: "gte", field: "uploadTs", value: startOfTodayUtc() },
      ],
    },
  })
  return counts.get("") ?? 0
}

/** In-flight reservations so concurrent uploads can't blow past the limit. */
const inFlight = new Map<string, { email: string; count: number }>()

export async function reserveUploadCapacity(
  user: OrbitUserRow,
  requested: number,
  reservationId: string
): Promise<void> {
  if (!isAdminUser(user) && user.isAllowedToUpload !== true) {
    throw new UploadNotAllowed()
  }
  const limit = await effectiveDailyLimit(user)
  if (limit === null) return
  const email = normalizeEmail(user.email)
  const usedToday = await getUploadsUsedToday(email)
  const reserved = [...inFlight.entries()]
    .filter(([id, r]) => r.email === email && id !== reservationId)
    .reduce((sum, [, r]) => sum + r.count, 0)
  if (usedToday + reserved + requested > limit) {
    throw new UploadQuotaExceeded({
      effectiveLimit: limit,
      uploadsUsedToday: usedToday,
      requestedUploads: requested,
      remainingUploads: Math.max(limit - usedToday - reserved, 0),
    })
  }
  inFlight.set(reservationId, { email, count: requested })
}

export function releaseUploadCapacity(reservationId: string): void {
  inFlight.delete(reservationId)
}

/**
 * Usage is derived from DocMeta rows, so committing is just dropping the
 * reservation — the registry rows written during upload ARE the usage record.
 */
export function commitUploadUsage(reservationId: string): void {
  inFlight.delete(reservationId)
}
