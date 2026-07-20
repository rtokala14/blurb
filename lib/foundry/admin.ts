import "server-only"

import { searchObjects } from "./client"
import { normalizeEmail } from "./ontology"
import { effectiveDailyLimit, todayUtc } from "./quota"
import { deriveNameFromEmail, type OrbitUserRow } from "./user"

/**
 * Admin metrics — the PoC's /api/admin/dashboard + /api/admin/analytics
 * merged into one bounded collector. Trends use ontology-side createdAt >=
 * range filters with projected columns; the full-corpus document census
 * (19k+ rows) is cached for five minutes.
 */

interface SessionLite {
  __primaryKey: string
  primaryKey_?: string
  user?: string
  createdAt?: string
  updatedAt?: string
  isDeleted?: boolean
  mode?: string
  title?: string
  currentRunStatus?: string
}

interface MessageLite {
  sessionId?: string
  createdAt?: string
  isAgent?: boolean
}

interface DocLite {
  addedBy?: string
  createdAt?: string
  isActive?: boolean
  isIndexed?: boolean
  noPages?: number
  sourceType?: string
}

interface UsageLite {
  email?: string
  usageDate?: string
  uploadsUsed?: number
}

export interface AdminUserSummary {
  primaryKey: string
  email: string
  name: string
  isAdmin: boolean
  isActive: boolean
  hasUnlimitedUploads: boolean
  dailyUploadLimit: number
  bonusUploadLimit: number
  bonusExpiresAt: string | null
  effectiveLimit: number | null
  uploadsUsedToday: number
  uploadsRemainingToday: number | null
  documents: number
  syncedDocuments: number
  createdAt: string | null
  updatedAt: string | null
}

export function serializeAdminUser(
  user: OrbitUserRow,
  usageToday: number,
  docCounts?: { manual: number; synced: number }
): AdminUserSummary {
  const limit = effectiveDailyLimit(user)
  return {
    primaryKey: String(user.primaryKey_ ?? user.__primaryKey ?? ""),
    email: normalizeEmail(user.email),
    name: user.name || deriveNameFromEmail(user.email ?? ""),
    isAdmin: Boolean(user.isAdmin),
    isActive: user.isActive !== false,
    hasUnlimitedUploads: Boolean(user.hasUnlimitedUploads),
    dailyUploadLimit: Number(user.dailyUploadLimit ?? 0) || 0,
    bonusUploadLimit: Number(user.bonusUploadLimit ?? 0) || 0,
    bonusExpiresAt: user.bonusExpiresAt ?? null,
    effectiveLimit: limit,
    uploadsUsedToday: usageToday,
    uploadsRemainingToday: limit === null ? null : Math.max(limit - usageToday, 0),
    documents: docCounts?.manual ?? 0,
    syncedDocuments: docCounts?.synced ?? 0,
    createdAt: user.createdAt ?? null,
    updatedAt: user.updatedAt ?? null,
  }
}

export async function listAllUsers(): Promise<OrbitUserRow[]> {
  return searchObjects<OrbitUserRow>("OrbitDocsUser", { pageSize: 1000 })
}

export async function usageTodayByEmail(): Promise<Map<string, number>> {
  const rows = await searchObjects<UsageLite>("OrbitDocsUserDailyUploadUsage", {
    where: { type: "eq", field: "usageDate", value: todayUtc() },
    pageSize: 2000,
  })
  const map = new Map<string, number>()
  for (const row of rows) {
    map.set(normalizeEmail(row.email), Number(row.uploadsUsed ?? 0) || 0)
  }
  return map
}

/* ------------------------------------------------------------------ */
/* Document census (full corpus, cached)                                */
/* ------------------------------------------------------------------ */

export interface DocCensus {
  totalActive: number
  indexed: number
  synced: number
  syncedIndexed: number
  manualPages: number
  syncedPages: number
  byOwner: Map<string, { manual: number; synced: number }>
}

let censusCache: { at: number; census: DocCensus } | null = null
let censusInFlight: Promise<DocCensus> | null = null
const CENSUS_TTL_MS = 5 * 60_000

export async function getDocCensus(): Promise<DocCensus> {
  if (censusCache && Date.now() - censusCache.at < CENSUS_TTL_MS) {
    return censusCache.census
  }
  if (censusInFlight) return censusInFlight
  censusInFlight = (async () => {
    // isIndexed on the doc row is stale tenant-wide — indexing truth lives in
    // OrbitDocIndexStatus (same join the rest of the app uses).
    const [rows, statusRows] = await Promise.all([
      searchObjects<DocLite & { primaryKey_?: string; __primaryKey?: string }>(
        "OrbitDocsList",
        {
          where: { type: "eq", field: "isActive", value: true },
          select: ["primaryKey_", "addedBy", "noPages", "sourceType"],
          pageSize: 10_000,
          maxItems: 100_000,
        }
      ),
      searchObjects<{ docKey?: string; isIndexingComplete?: boolean }>(
        "OrbitDocIndexStatus",
        {
          select: ["docKey", "isIndexingComplete"],
          pageSize: 10_000,
          maxItems: 100_000,
        }
      ),
    ])
    const indexedKeys = new Set(
      statusRows.flatMap((s) =>
        s.isIndexingComplete && s.docKey ? [String(s.docKey)] : []
      )
    )
    const census: DocCensus = {
      totalActive: 0,
      indexed: 0,
      synced: 0,
      syncedIndexed: 0,
      manualPages: 0,
      syncedPages: 0,
      byOwner: new Map(),
    }
    for (const row of rows) {
      census.totalActive++
      const synced = Boolean((row.sourceType ?? "").trim())
      const pages = Number(row.noPages ?? 0) || 0
      if (synced) {
        census.synced++
        census.syncedPages += pages
      } else {
        census.manualPages += pages
      }
      if (indexedKeys.has(String(row.primaryKey_ ?? row.__primaryKey ?? ""))) {
        census.indexed++
        if (synced) census.syncedIndexed++
      }
      const owner = normalizeEmail(row.addedBy)
      if (owner) {
        const counts = census.byOwner.get(owner) ?? { manual: 0, synced: 0 }
        if (synced) counts.synced++
        else counts.manual++
        census.byOwner.set(owner, counts)
      }
    }
    censusCache = { at: Date.now(), census }
    return census
  })().finally(() => {
    censusInFlight = null
  })
  return censusInFlight
}

/* ------------------------------------------------------------------ */
/* Overview (totals + trends + leaderboards)                            */
/* ------------------------------------------------------------------ */

export interface OverviewOptions {
  days: number
  includeAdmins: boolean
  includeSynced: boolean
}

const dayKey = (iso: string | undefined): string | null => {
  if (!iso) return null
  const key = iso.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null
}

export async function collectOverview(options: OverviewOptions) {
  const days = Math.max(7, Math.min(options.days, 120))
  const start = new Date(Date.now() - (days - 1) * 86_400_000)
  const startIso = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  ).toISOString()

  const [users, usageToday, census, sessions, messages, docsInRange] =
    await Promise.all([
      listAllUsers(),
      usageTodayByEmail(),
      getDocCensus(),
      searchObjects<SessionLite>("OrbitDocsUserSessions", {
        where: { type: "gte", field: "createdAt", value: startIso },
        select: ["primaryKey_", "user", "createdAt", "isDeleted", "mode"],
        pageSize: 5000,
        maxItems: 50_000,
      }),
      searchObjects<MessageLite>("OrbitSessionMessages", {
        where: { type: "gte", field: "createdAt", value: startIso },
        select: ["sessionId", "createdAt", "isAgent"],
        pageSize: 10_000,
        maxItems: 100_000,
      }),
      searchObjects<DocLite>("OrbitDocsList", {
        where: {
          type: "and",
          value: [
            { type: "eq", field: "isActive", value: true },
            { type: "gte", field: "createdAt", value: startIso },
          ],
        },
        select: ["addedBy", "createdAt", "sourceType"],
        pageSize: 10_000,
        maxItems: 100_000,
      }),
    ])

  const adminEmails = new Set(
    users.flatMap((u) => (u.isAdmin ? [normalizeEmail(u.email)] : []))
  )
  adminEmails.delete("")
  const excludeOwner = (owner: string) =>
    !options.includeAdmins && adminEmails.has(owner)

  /* per-day scaffolding */
  const keys: string[] = []
  for (let i = 0; i < days; i++) {
    keys.push(new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10))
  }
  const trends = new Map(
    keys.map((key) => [
      key,
      { date: key, sessions: 0, turns: 0, documents: 0, uniqueUsers: 0 },
    ])
  )
  const dayUsers = new Map<string, Set<string>>(keys.map((k) => [k, new Set()]))
  const perUser = new Map<
    string,
    { sessions: number; turns: number; documents: number }
  >()
  const bump = (owner: string, field: "sessions" | "turns" | "documents") => {
    const stats = perUser.get(owner) ?? { sessions: 0, turns: 0, documents: 0 }
    stats[field]++
    perUser.set(owner, stats)
  }

  /* sessions */
  const sessionOwner = new Map<string, string>()
  const excludedSessionIds = new Set<string>()
  const today = todayUtc()
  let sessionsToday = 0
  let thinkingSessions = 0
  for (const session of sessions) {
    if (session.isDeleted) continue
    const owner = normalizeEmail(session.user)
    const id = String(session.primaryKey_ ?? session.__primaryKey ?? "")
    if (excludeOwner(owner)) {
      if (id) excludedSessionIds.add(id)
      continue
    }
    if (id && owner) sessionOwner.set(id, owner)
    const key = dayKey(session.createdAt)
    if (key && trends.has(key)) {
      trends.get(key)!.sessions++
      if (owner) {
        dayUsers.get(key)!.add(owner)
        bump(owner, "sessions")
      }
    }
    if (key === today) sessionsToday++
    if (session.mode === "thinking") thinkingSessions++
  }

  /* turns (user messages only — one turn per exchange) */
  for (const message of messages) {
    if (message.isAgent) continue
    const sessionId = String(message.sessionId ?? "")
    if (excludedSessionIds.has(sessionId)) continue
    const key = dayKey(message.createdAt)
    if (!key || !trends.has(key)) continue
    trends.get(key)!.turns++
    const owner = sessionOwner.get(sessionId)
    if (owner) {
      dayUsers.get(key)!.add(owner)
      bump(owner, "turns")
    }
  }

  /* documents added in range */
  let docsTodayCount = 0
  for (const doc of docsInRange) {
    const synced = Boolean((doc.sourceType ?? "").trim())
    if (synced && !options.includeSynced) continue
    const owner = normalizeEmail(doc.addedBy)
    // synced arrivals are organizational, not the owning admin's activity
    if (!synced && excludeOwner(owner)) continue
    const key = dayKey(doc.createdAt)
    if (!key || !trends.has(key)) continue
    if (key === today) docsTodayCount++
    // The trend series charts MANUAL uploads only: a bulk sync lands tens of
    // thousands of rows in one day and flattens every activity series to
    // zero (mixed scales). Synced volume lives in the corpus tiles.
    if (synced) continue
    trends.get(key)!.documents++
    if (owner) {
      dayUsers.get(key)!.add(owner)
      bump(owner, "documents")
    }
  }

  for (const key of keys) {
    trends.get(key)!.uniqueUsers = dayUsers.get(key)!.size
  }

  /* uploads today from usage rows */
  let uploadsToday = 0
  for (const [email, used] of usageToday) {
    if (excludeOwner(email)) continue
    uploadsToday += used
  }

  /* corpus totals honoring the synced toggle. Indexing coverage is a
     corpus-quality metric, so its base only follows the synced toggle —
     never the admin toggle. */
  const indexedBase = options.includeSynced
    ? census.totalActive
    : census.totalActive - census.synced
  const corpusIndexed = options.includeSynced
    ? census.indexed
    : census.indexed - census.syncedIndexed
  let corpusDocs = indexedBase
  if (!options.includeAdmins) {
    // Only manual docs are admin *activity* — synced corpus content stays
    // regardless of which service identity registered it.
    for (const email of adminEmails) {
      const counts = census.byOwner.get(email)
      if (counts) corpusDocs -= counts.manual
    }
  }

  /* near-quota users */
  const nearQuota = users.flatMap((u) => {
    if (!(u.isActive !== false && (options.includeAdmins || !u.isAdmin))) return []
    const serialized = serializeAdminUser(
      u,
      usageToday.get(normalizeEmail(u.email)) ?? 0
    )
    return serialized.uploadsRemainingToday !== null &&
      serialized.uploadsRemainingToday <= 2
      ? [serialized]
      : []
  })

  /* power users */
  const powerUsers = [...perUser.entries()]
    .flatMap(([email, s]) => {
      if (!(email && s.sessions + s.turns + s.documents > 0)) return []
      const user = users.find((u) => normalizeEmail(u.email) === email)
      return [
        {
          email,
          name: user?.name || deriveNameFromEmail(email),
          isAdmin: Boolean(user?.isAdmin),
          ...s,
        },
      ]
    })
    .sort(
      (a, b) =>
        b.turns - a.turns || b.sessions - a.sessions || b.documents - a.documents
    )
    .slice(0, 10)

  return {
    generatedAt: new Date().toISOString(),
    days,
    includeAdmins: options.includeAdmins,
    includeSynced: options.includeSynced,
    totals: {
      users: users.length,
      activeUsers: users.filter((u) => u.isActive !== false).length,
      admins: users.filter((u) => u.isAdmin).length,
      unlimitedUsers: users.filter((u) => u.hasUnlimitedUploads).length,
      usersNearQuota: nearQuota.length,
      uploadsToday,
      sessionsToday,
      docsToday: docsTodayCount,
      thinkingSessionsInRange: thinkingSessions,
      corpus: {
        documents: corpusDocs,
        indexed: corpusIndexed,
        indexedBase,
        indexedPct: indexedBase > 0 ? Math.round((corpusIndexed / indexedBase) * 100) : 0,
        syncedDocuments: census.synced,
        manualDocuments: census.totalActive - census.synced,
        totalPages:
          census.manualPages + (options.includeSynced ? census.syncedPages : 0),
      },
    },
    trends: keys.map((key) => trends.get(key)!),
    powerUsers,
    usersNearQuota: nearQuota,
  }
}

/* ------------------------------------------------------------------ */
/* Sessions across users (admin view)                                   */
/* ------------------------------------------------------------------ */

export async function listAllSessions(limit = 200): Promise<
  {
    rid: string
    title: string
    user: string
    mode: string
    createdAt: string | null
    updatedAt: string | null
    runStatus: string
  }[]
> {
  const rows = await searchObjects<SessionLite>("OrbitDocsUserSessions", {
    select: [
      "primaryKey_",
      "title",
      "user",
      "mode",
      "createdAt",
      "updatedAt",
      "isDeleted",
      "currentRunStatus",
    ],
    orderBy: { fields: [{ field: "updatedAt", direction: "desc" }] },
    pageSize: Math.min(limit * 2, 1000),
    maxItems: limit * 2,
  })
  return rows
    .filter((row) => !row.isDeleted)
    .slice(0, limit)
    .map((row) => ({
      rid: String(row.primaryKey_ ?? row.__primaryKey ?? ""),
      title: row.title || "Untitled",
      user: normalizeEmail(row.user),
      mode: row.mode === "thinking" ? "thinking" : "regular",
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
      runStatus: row.currentRunStatus || "idle",
    }))
}
