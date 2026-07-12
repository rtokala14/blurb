import "server-only"

import { applyAction, searchObjects } from "./client"
import { normalizeEmail } from "./ontology"
import { UserResolutionError, type OrbitUserRow } from "./user"

/**
 * Daily upload quota — port of the PoC's services/upload_quota.py.
 * Usage lives in OrbitDocsUserDailyUploadUsage rows keyed by (email, date);
 * the effective limit is daily + unexpired bonus, with admins and
 * has_unlimited_uploads users exempt.
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

interface UsageRow {
  __primaryKey: string
  primaryKey_?: string
  email?: string
  usageDate?: string
  uploadsUsed?: number
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/** null = unlimited (admin or has_unlimited_uploads). */
export function effectiveDailyLimit(user: OrbitUserRow): number | null {
  if (user.isAdmin || user.hasUnlimitedUploads) return null
  const daily = Number(user.dailyUploadLimit ?? 0) || 0
  const bonus = Number(user.bonusUploadLimit ?? 0) || 0
  const expires = user.bonusExpiresAt ? Date.parse(user.bonusExpiresAt) : NaN
  const bonusActive = !user.bonusExpiresAt || !(expires < Date.now())
  return bonusActive ? daily + bonus : daily
}

export async function getUsageToday(email: string): Promise<UsageRow | null> {
  const rows = await searchObjects<UsageRow>("OrbitDocsUserDailyUploadUsage", {
    where: {
      type: "and",
      value: [
        { type: "eq", field: "email", value: normalizeEmail(email) },
        { type: "eq", field: "usageDate", value: todayUtc() },
      ],
    },
    pageSize: 10,
  })
  return rows[0] ?? null
}

/** In-flight reservations so concurrent uploads can't blow past the limit. */
const inFlight = new Map<string, { email: string; count: number }>()

export async function reserveUploadCapacity(
  user: OrbitUserRow,
  requested: number,
  reservationId: string
): Promise<void> {
  const limit = effectiveDailyLimit(user)
  if (limit === null) return
  const email = normalizeEmail(user.email)
  const usage = await getUsageToday(email)
  const usedToday = Number(usage?.uploadsUsed ?? 0) || 0
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

/** Record completed uploads in today's usage row (create or edit). */
export async function commitUploadUsage(
  email: string,
  uploaded: number,
  reservationId: string
): Promise<void> {
  inFlight.delete(reservationId)
  if (uploaded <= 0) return
  const normalized = normalizeEmail(email)
  const timestamp = new Date().toISOString()
  const usage = await getUsageToday(normalized)
  if (usage) {
    await applyAction("edit-orbit-docs-user-daily-upload-usage", {
      OrbitDocsUserDailyUploadUsage: String(usage.primaryKey_ ?? usage.__primaryKey),
      email: normalized,
      usageDate: usage.usageDate ?? todayUtc(),
      uploadsUsed: (Number(usage.uploadsUsed ?? 0) || 0) + uploaded,
      lastUploadAt: timestamp,
      updatedAt: timestamp,
    })
  } else {
    await applyAction("create-orbit-docs-user-daily-upload-usage", {
      email: normalized,
      usageDate: todayUtc(),
      uploadsUsed: uploaded,
      lastUploadAt: timestamp,
      updatedAt: timestamp,
    })
  }
}
