import "server-only"

import { countObjects, searchObjects } from "./client"
import {
  activeBonusUploads,
  listAllGrants,
  normalizeEmail,
  parseOptions,
  sessionOptions,
  type GrantRow,
  type SessionRow,
} from "./ontology"
import { startOfTodayUtc } from "./quota"
import {
  deriveNameFromEmail,
  isAdminUser,
  listAllUsers,
  userDailyLimit,
  type OrbitUserRow,
} from "./user"

/**
 * Admin metrics over the v3 model. Upload usage is derived from DocMeta
 * uploadTs (no usage object); bonuses come from RateLimitGrants; indexing
 * truth is chunk counts per document.
 */

export { listAllUsers }

interface SessionLite {
  __primaryKey?: string
  sessionId?: string
  userEmail?: string
  title?: string
  createdAt?: string
  lastUpdatedAt?: string
  isDeleted?: boolean | null
  options?: string
}

interface MessageLite {
  sessionId?: string
  createdAt?: string
  role?: string
}

interface DocLite {
  __primaryKey?: string
  documentId?: string
  userEmail?: string
  uploadTs?: string
}

export interface AdminUserSummary {
  primaryKey: string
  email: string
  name: string
  role: string
  isAdmin: boolean
  isActive: boolean
  isOnboarded: boolean
  isAllowedToUpload: boolean
  dailyUploadLimit: number
  activeBonusUploads: number
  effectiveLimit: number | null
  uploadsUsedToday: number
  uploadsRemainingToday: number | null
  documents: number
  createdAt: string | null
  updatedAt: string | null
}

export function serializeAdminUser(
  user: OrbitUserRow,
  {
    usageToday = 0,
    grants = [],
    documents = 0,
  }: { usageToday?: number; grants?: GrantRow[]; documents?: number } = {}
): AdminUserSummary {
  const admin = isAdminUser(user)
  const bonus = activeBonusUploads(grants)
  const limit = admin ? null : userDailyLimit(user) + bonus
  return {
    primaryKey: String(user.__primaryKey ?? user.email ?? ""),
    email: normalizeEmail(user.email),
    name: user.name || deriveNameFromEmail(user.email ?? ""),
    role: user.role ?? "user",
    isAdmin: admin,
    isActive: true,
    isOnboarded: user.isOnboarded === true,
    isAllowedToUpload: admin || user.isAllowedToUpload === true,
    dailyUploadLimit: userDailyLimit(user),
    activeBonusUploads: bonus,
    effectiveLimit: limit,
    uploadsUsedToday: usageToday,
    uploadsRemainingToday:
      limit === null ? null : Math.max(limit - usageToday, 0),
    documents,
    createdAt: user.createdAt ?? null,
    updatedAt: user.updatedAt ?? null,
  }
}

/** Uploads since UTC midnight, grouped by uploader. */
export async function usageTodayByEmail(): Promise<Map<string, number>> {
  const counts = await countObjects("OrbitDocsDocMeta", {
    where: { type: "gte", field: "uploadTs", value: startOfTodayUtc() },
    groupByField: "userEmail",
  })
  const map = new Map<string, number>()
  for (const [email, count] of counts) {
    map.set(normalizeEmail(email), count)
  }
  return map
}

/** Active grants grouped by user email. */
export async function grantsByEmail(): Promise<Map<string, GrantRow[]>> {
  const grants = await listAllGrants()
  const map = new Map<string, GrantRow[]>()
  for (const grant of grants) {
    const email = normalizeEmail(grant.userEmail)
    if (!email) continue
    const list = map.get(email) ?? []
    list.push(grant)
    map.set(email, list)
  }
  return map
}

/* ------------------------------------------------------------------ */
/* Document census (cached)                                             */
/* ------------------------------------------------------------------ */

export interface DocCensus {
  total: number
  indexed: number
  byOwner: Map<string, number>
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
    const [docsByOwner, chunkedDocs] = await Promise.all([
      countObjects("OrbitDocsDocMeta", { groupByField: "userEmail" }),
      // distinct documents with at least one chunk = indexed documents
      countObjects("OrbitDocsChunks", { groupByField: "documentId" }),
    ])
    const byOwner = new Map<string, number>()
    let total = 0
    for (const [email, count] of docsByOwner) {
      byOwner.set(normalizeEmail(email), count)
      total += count
    }
    const census: DocCensus = {
      total,
      indexed: [...chunkedDocs.keys()].filter(Boolean).length,
      byOwner,
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

  const [users, usageToday, allGrants, census, sessions, messages, docsInRange] =
    await Promise.all([
      listAllUsers(),
      usageTodayByEmail(),
      grantsByEmail(),
      getDocCensus(),
      searchObjects<SessionLite>("OrbitDocsChatSessions", {
        where: { type: "gte", field: "createdAt", value: startIso },
        select: ["sessionId", "userEmail", "createdAt", "isDeleted"],
        pageSize: 5000,
        maxItems: 50_000,
      }),
      searchObjects<MessageLite>("OrbitDocsChatMessages", {
        where: { type: "gte", field: "createdAt", value: startIso },
        select: ["sessionId", "createdAt", "role"],
        pageSize: 10_000,
        maxItems: 100_000,
      }),
      searchObjects<DocLite>("OrbitDocsDocMeta", {
        where: { type: "gte", field: "uploadTs", value: startIso },
        select: ["documentId", "userEmail", "uploadTs"],
        pageSize: 10_000,
        maxItems: 100_000,
      }),
    ])

  const adminEmails = new Set(
    users.flatMap((u) => (isAdminUser(u) ? [normalizeEmail(u.email)] : []))
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
  const today = new Date().toISOString().slice(0, 10)
  let sessionsToday = 0
  for (const session of sessions) {
    if (session.isDeleted === true) continue
    const owner = normalizeEmail(session.userEmail)
    const id = String(session.sessionId ?? session.__primaryKey ?? "")
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
  }

  /* turns (user messages only — one turn per exchange) */
  for (const message of messages) {
    if (message.role === "assistant") continue
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
  let uploadsToday = 0
  for (const doc of docsInRange) {
    const owner = normalizeEmail(doc.userEmail)
    if (excludeOwner(owner)) continue
    const key = dayKey(doc.uploadTs)
    if (!key || !trends.has(key)) continue
    if (key === today) docsTodayCount++
    trends.get(key)!.documents++
    if (owner) {
      dayUsers.get(key)!.add(owner)
      bump(owner, "documents")
    }
  }
  for (const [email, used] of usageToday) {
    if (excludeOwner(email)) continue
    uploadsToday += used
  }

  for (const key of keys) {
    trends.get(key)!.uniqueUsers = dayUsers.get(key)!.size
  }

  /* corpus totals */
  let corpusDocs = census.total
  if (!options.includeAdmins) {
    for (const email of adminEmails) {
      corpusDocs -= census.byOwner.get(email) ?? 0
    }
  }

  /* near-quota users */
  const nearQuota = users.flatMap((u) => {
    if (!options.includeAdmins && isAdminUser(u)) return []
    const email = normalizeEmail(u.email)
    const serialized = serializeAdminUser(u, {
      usageToday: usageToday.get(email) ?? 0,
      grants: allGrants.get(email) ?? [],
    })
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
          isAdmin: isAdminUser(user),
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
    includeSynced: true,
    totals: {
      users: users.length,
      activeUsers: users.length,
      admins: adminEmails.size,
      onboardedUsers: users.filter((u) => u.isOnboarded === true).length,
      uploadEnabledUsers: users.filter(
        (u) => isAdminUser(u) || u.isAllowedToUpload === true
      ).length,
      usersNearQuota: nearQuota.length,
      uploadsToday,
      sessionsToday,
      docsToday: docsTodayCount,
      corpus: {
        documents: corpusDocs,
        indexed: census.indexed,
        indexedBase: census.total,
        indexedPct:
          census.total > 0
            ? Math.round((census.indexed / census.total) * 100)
            : 0,
        syncedDocuments: 0,
        manualDocuments: census.total,
        totalPages: 0,
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
  const rows = await searchObjects<SessionLite>("OrbitDocsChatSessions", {
    select: [
      "sessionId",
      "title",
      "userEmail",
      "createdAt",
      "lastUpdatedAt",
      "isDeleted",
      "options",
    ],
    orderBy: { fields: [{ field: "lastUpdatedAt", direction: "desc" }] },
    pageSize: Math.min(limit * 2, 1000),
    maxItems: limit * 2,
  })
  return rows
    .filter((row) => row.isDeleted !== true)
    .slice(0, limit)
    .map((row) => ({
      rid: String(row.sessionId ?? row.__primaryKey ?? ""),
      title: row.title || "Untitled",
      user: normalizeEmail(row.userEmail),
      mode: "regular",
      createdAt: row.createdAt ?? null,
      updatedAt: row.lastUpdatedAt ?? null,
      runStatus:
        sessionOptions(row as SessionRow).currentRun?.status ?? "idle",
    }))
}
