import "server-only"

import {
  applyAction,
  extractCreatedPrimaryKey,
  getObject,
  getObjectsByIds,
  IN_FILTER_CHUNK,
  searchObjects,
  searchObjectsPage,
} from "./client"
import { getFoundryConfig } from "./config"
import { normalizeMode } from "./turn"

/**
 * Ontology-backed data layer mirroring the PoC backend semantics
 * (user scoping, soft deletes checked in JS because `isDeleted` is nullable,
 * attachment preservation on partial session edits).
 */

/* ------------------------------------------------------------------ */
/* Row types (REST camelCase property names, verified against openapi)  */
/* ------------------------------------------------------------------ */

export interface DocRow {
  __primaryKey: string
  primaryKey_?: string
  documentName?: string
  addedBy?: string
  isActive?: boolean
  isIndexed?: boolean
  createdAt?: string
  noPages?: number
  reference?: { mimeType?: string; reference?: unknown } | unknown
  sourceType?: string
  sourceSyncConfigPk?: string
  sourceRelativePath?: string
  sourceWebUrl?: string
  syncStatus?: string
  vlm?: boolean
}

export interface IndexStatusRow {
  __primaryKey: string
  docKey?: string
  isIndexingComplete?: boolean
  embeddingCount?: number
  lastUpdated?: string
  noPages?: number
}

export interface FolderRow {
  __primaryKey: string
  name?: string
  color?: string
  createdBy?: string
  accessEmails?: string[]
  contents?: string[]
  updatedAt?: string
  isSyncManaged?: boolean
  sourceSyncConfigPk?: string
}

export interface SessionRow {
  __primaryKey: string
  user?: string
  title?: string
  mode?: string
  summary?: string
  createdAt?: string
  updatedAt?: string
  isDeleted?: boolean
  docsAttached?: string[]
  foldersAttached?: string[]
  chatFolderId?: string
  activeBranchId?: string
  defaultBranchId?: string
  currentRunStatus?: string
  currentRunError?: string
  currentAgentRid?: string
  currentAgentVersion?: string
  currentSessionId?: string
  currentMessageId?: string
  currentSessionTraceId?: string
}

export interface MessageRow {
  __primaryKey: string
  sessionId?: string
  message?: string
  isAgent?: boolean
  title?: string
  mode?: string
  createdAt?: string
  parentMessageId?: string
  branchId?: string
  branchIndex?: number
  hasAlternateBranches?: boolean
  alternateBranchCount?: number
}

export interface BranchRow {
  __primaryKey: string
  sessionId?: string
  name?: string
  isDefault?: boolean
  isDeleted?: boolean
  anchorMessageId?: string
  headMessageId?: string
  summary?: string
  createdBy?: string
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
}

export interface ChatFolderRow {
  __primaryKey: string
  primaryKey_?: string
  name?: string
  color?: string
  createdBy?: string
  updatedAt?: string
  isDeleted?: boolean
  deletedAt?: string
}

export interface SyncSourceRow {
  __primaryKey: string
  displayName?: string
  localRootPath?: string
  isActive?: boolean
  lastSyncStatus?: string
  lastSyncCompletedAt?: string
  errorCount?: number
  sourceWebUrl?: string
  ownerEmail?: string
  sharedWith?: string[]
}

export const pk = (row: { __primaryKey?: unknown; primaryKey_?: unknown }) =>
  String(row.primaryKey_ ?? row.__primaryKey ?? "")

export const normalizeEmail = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase()

/** Case-insensitive email equality — use for EVERY email comparison. */
export const sameEmail = (
  a: string | null | undefined,
  b: string | null | undefined
) => normalizeEmail(a) !== "" && normalizeEmail(a) === normalizeEmail(b)

/**
 * Case-insensitive upstream email filter. Plain `eq` is case-sensitive and
 * the tenant holds mixed-case rows (e.g. "Rohit.Tokala@jacobs.com" beside
 * "rohit.tokala@…" — verified live: eq-lower missed 30 docs / 6 sessions /
 * 2 folders). The search index lowercases terms, so `containsAllTerms`
 * matches any casing exactly; callers MUST still JS-verify rows with
 * sameEmail() because a token permutation could over-match in theory.
 */
export const emailWhere = (field: string, email: string) =>
  ({
    type: "containsAllTerms",
    field,
    value: normalizeEmail(email),
  }) as const

const now = () => new Date().toISOString()

function byCreatedAt<T extends { createdAt?: string; __primaryKey: string }>(
  a: T,
  b: T
) {
  const ta = a.createdAt ?? ""
  const tb = b.createdAt ?? ""
  if (ta !== tb) return ta < tb ? -1 : 1
  return pk(a) < pk(b) ? -1 : 1
}

/* ------------------------------------------------------------------ */
/* Documents & folders                                                  */
/* ------------------------------------------------------------------ */

/**
 * Tiny single-flight TTL cache. Collapses the paired /bootstrap + /docs +
 * /docs/status bursts (which all touch the same two full-scans) into one
 * upstream query each — the dominant latency win, mirroring the PoC's 5s
 * in-process caches.
 *
 * With `staleMs` set it also serves stale-while-revalidate: a value older
 * than ttlMs but younger than staleMs is returned immediately while a
 * background refresh runs, so idle-expired requests skip the upstream wait.
 */
function memoTTL<T>(
  ttlMs: number,
  load: () => Promise<T>,
  { staleMs = 0 }: { staleMs?: number } = {}
) {
  let value: { at: number; data: T } | null = null
  let inFlight: Promise<T> | null = null
  const refresh = () => {
    if (inFlight) return inFlight
    inFlight = load()
      .then((data) => {
        value = { at: Date.now(), data }
        return data
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }
  const fn = async (): Promise<T> => {
    const age = value ? Date.now() - value.at : Infinity
    if (value && age < ttlMs) return value.data
    if (value && age < staleMs) {
      void refresh().catch(() => undefined)
      return value.data
    }
    return refresh()
  }
  fn.invalidate = () => {
    value = null
  }
  return fn
}

const CACHE_TTL_MS = 5_000
/** Folder membership changes rarely; serve stale up to 10 min while refreshing. */
const FOLDER_STALE_MS = 10 * 60_000

const folderCacheByUser = new Map<
  string,
  ReturnType<typeof memoTTL<FolderRow[]>>
>()

/** Bust folder caches after any folder mutation. */
export function invalidateFolderCache(): void {
  for (const loader of folderCacheByUser.values()) loader.invalidate()
}

export async function getAccessibleFolders(userEmail: string): Promise<FolderRow[]> {
  const user = normalizeEmail(userEmail)
  let loader = folderCacheByUser.get(user)
  if (!loader) {
    loader = memoTTL(CACHE_TTL_MS, async () => {
      // One small query instead of two 10k-row scans: sync-managed folders
      // are excluded upstream — verified live that they carry NO contents
      // (500-row sample: 0 non-empty), so membership, access checks, and
      // the UI lose nothing, while the cold path drops from ~8,800 full
      // folder payloads to a handful of user folders.
      const rows = await searchObjects<FolderRow>("OrbitFolders", {
        where: {
          type: "and",
          value: [
            {
              type: "or",
              value: [
                // case-insensitive (term match); over-matches rejected below
                emailWhere("createdBy", user),
                { type: "contains", field: "accessEmails", value: user },
              ],
            },
            { type: "not", value: { type: "eq", field: "isSyncManaged", value: true } },
          ],
        },
        pageSize: 1000,
      })
      return rows.filter(
        (f) =>
          sameEmail(f.createdBy, user) ||
          (f.accessEmails ?? []).some((e) => sameEmail(e, user))
      )
    }, { staleMs: FOLDER_STALE_MS })
    folderCacheByUser.set(user, loader)
  }
  return loader()
}

const INDEX_STATUS_FIELDS = [
  "docKey",
  "isIndexingComplete",
  "embeddingCount",
  "lastUpdated",
  "noPages",
]

/** doc pk -> {fetchedAt, row|null}; null caches "no status row exists". */
const indexStatusByDoc = new Map<
  string,
  { at: number; row: IndexStatusRow | null }
>()
/** doc pk -> in-flight batch fetch covering it (collapses request bursts). */
const indexStatusInFlight = new Map<string, Promise<void>>()

/**
 * Index status for a specific set of documents via chunked `in` filters on
 * docKey (verified live: 100 keys ≈ 220 ms). Replaces the PoC's full-table
 * scan, which on the real tenant is ~21k rows / multiple seconds. Rows are
 * cached per doc for CACHE_TTL_MS so the bootstrap + docs + status-poll
 * burst still collapses into one upstream query per doc set.
 */
export async function getIndexStatusForDocs(
  docIds: string[]
): Promise<Map<string, IndexStatusRow>> {
  const unique = [
    ...new Set(
      docIds.flatMap((id) => {
        const s = String(id)
        return s ? [s] : []
      })
    ),
  ]
  const now = Date.now()
  const missing: string[] = []
  const waits: Promise<void>[] = []
  for (const id of unique) {
    const cached = indexStatusByDoc.get(id)
    if (cached && now - cached.at < CACHE_TTL_MS) continue
    const inFlight = indexStatusInFlight.get(id)
    if (inFlight) waits.push(inFlight)
    else missing.push(id)
  }

  if (missing.length > 0) {
    const chunks: string[][] = []
    for (let i = 0; i < missing.length; i += IN_FILTER_CHUNK) {
      chunks.push(missing.slice(i, i + IN_FILTER_CHUNK))
    }
    const fetchAll = (async () => {
      const pages = await Promise.all(
        chunks.map((chunk) =>
          searchObjects<IndexStatusRow>("OrbitDocIndexStatus", {
            where: { type: "in", field: "docKey", value: chunk },
            select: INDEX_STATUS_FIELDS,
          })
        )
      )
      const at = Date.now()
      const found = new Set<string>()
      for (const row of pages.flat()) {
        if (!row.docKey) continue
        const key = String(row.docKey)
        indexStatusByDoc.set(key, { at, row })
        found.add(key)
      }
      for (const id of missing) {
        if (!found.has(id)) indexStatusByDoc.set(id, { at, row: null })
      }
    })().finally(() => {
      for (const id of missing) indexStatusInFlight.delete(id)
    })
    for (const id of missing) indexStatusInFlight.set(id, fetchAll)
    waits.push(fetchAll)
  }

  await Promise.all(waits)
  const result = new Map<string, IndexStatusRow>()
  for (const id of unique) {
    const row = indexStatusByDoc.get(id)?.row
    if (row) result.set(id, row)
  }
  return result
}

export interface ListDocsResult {
  docs: DocRow[]
  /** doc pk -> folder names it is shared through */
  sharedFolderNames: Map<string, string[]>
  folders: FolderRow[]
  indexStatus: Map<string, IndexStatusRow>
}

/** Columns serializeDoc needs — projected so the 19k-row doc table never
 * ships unused properties. */
const DOC_LIST_FIELDS = [
  "primaryKey_",
  "documentName",
  "addedBy",
  "isActive",
  "isIndexed",
  "createdAt",
  "noPages",
  "reference",
  "sourceType",
  "sourceSyncConfigPk",
  "sourceWebUrl",
  "vlm",
]

/** PoC /api/docs default response cap. */
const DOC_LIST_LIMIT = 200
/** Ceiling on docs pulled in via user-folder contents (defensive bound). */
const FOLDER_DOCS_CAP = 2_000

/** Map doc pk -> names of the (non-sync-managed) folders containing it. */
function folderMembership(folders: FolderRow[]): {
  sharedFolderNames: Map<string, string[]>
  folderDocIds: Set<string>
} {
  const sharedFolderNames = new Map<string, string[]>()
  const folderDocIds = new Set<string>()
  // Sync-managed folders keep docs *accessible* but their membership is
  // organizational noise (and their contents can be enormous) — only real
  // user folders drive Library grouping and eager fetching.
  for (const folder of folders.filter((f) => !f.isSyncManaged)) {
    for (const docId of folder.contents ?? []) {
      const id = String(docId)
      folderDocIds.add(id)
      const names = sharedFolderNames.get(id) ?? []
      names.push(folder.name ?? "Folder")
      sharedFolderNames.set(id, names)
    }
  }
  return { sharedFolderNames, folderDocIds }
}

/**
 * Owned docs + docs shared via accessible folders (PoC /api/docs).
 *
 * The PoC full-scans the doc table and slices to `limit` after sorting;
 * against the real tenant (~19k active docs for one user) that is dozens of
 * pages per request. We push the sort + cap upstream instead: one
 * `orderBy createdAt desc` page of `limit` rows (verified live).
 *
 * The `limit` applies to the rolling window of RAW documents (outside user
 * folders). Every document inside an accessible user folder is always
 * fetched and returned (bounded by FOLDER_DOCS_CAP), so folders are never
 * empty just because their files are older than the window.
 */
export async function listAccessibleDocs(
  userEmail: string,
  {
    includeSynced = true,
    limit = DOC_LIST_LIMIT,
  }: { includeSynced?: boolean; limit?: number } = {}
): Promise<ListDocsResult> {
  const user = normalizeEmail(userEmail)
  const foldersPromise = getAccessibleFolders(user)
  const ownedPage = await searchObjectsPage<DocRow>("OrbitDocsList", {
    where: {
      type: "and",
      value: [
        // case-insensitive (term match); over-matches rejected below
        emailWhere("addedBy", user),
        { type: "eq", field: "isActive", value: true },
      ],
    },
    orderBy: { fields: [{ field: "createdAt", direction: "desc" }] },
    select: DOC_LIST_FIELDS,
    pageSize: limit,
  })
  const ownedDocs = ownedPage.data.filter((d) => sameEmail(d.addedBy, user))
  // Warm the per-doc status cache while the (slower) folder scan finishes —
  // the final getIndexStatusForDocs below then only fetches folder-shared
  // stragglers.
  const ownedStatusWarm = getIndexStatusForDocs(ownedDocs.map(pk)).catch(
    () => undefined
  )
  const folders = await foldersPromise
  const { sharedFolderNames, folderDocIds } = folderMembership(folders)

  const docsById = new Map<string, DocRow>()
  for (const doc of ownedDocs) docsById.set(pk(doc), doc)
  // Fetch EVERY user-folder doc not already in the owned window — own files
  // older than the window and files shared by other users alike.
  const missingFolderDocs = [...folderDocIds]
    .filter((id) => !docsById.has(id))
    .slice(0, FOLDER_DOCS_CAP)
  if (missingFolderDocs.length > 0) {
    const shared = await getObjectsByIds<DocRow>(
      "OrbitDocsList",
      "primaryKey_",
      missingFolderDocs
    )
    for (const [id, doc] of shared) {
      if (doc.isActive !== false) docsById.set(id, doc)
    }
  }

  let docs = [...docsById.values()]
  if (!includeSynced) {
    docs = docs.filter((d) => !(d.sourceType ?? "").trim())
  }
  // Cap the raw window only — folder members always survive, so the Library
  // tree shows complete folders plus the newest `limit` loose files.
  const rawDocs = docs
    .filter((d) => !folderDocIds.has(pk(d)))
    .sort((a, b) => byCreatedAt(b, a))
    .slice(0, limit)
  const folderDocs = docs.filter((d) => folderDocIds.has(pk(d)))
  docs = [...folderDocs, ...rawDocs].sort((a, b) => byCreatedAt(b, a))
  // Status only for the docs we actually return — not the whole 21k-row table.
  await ownedStatusWarm
  const indexStatus = await getIndexStatusForDocs(docs.map(pk))
  return { docs, sharedFolderNames, folders, indexStatus }
}

export async function getDoc(pkValue: string): Promise<DocRow | null> {
  return getObject<DocRow>("OrbitDocsList", pkValue)
}

/**
 * Server-side document search across the user's WHOLE corpus (~19k docs on
 * the real tenant), not just the newest page the library holds. Uses the
 * ontology's `containsAllTerms` text match on documentName (verified live),
 * pushed upstream with the same access filters as listAccessibleDocs.
 * Folder-shared docs are matched by substring over the (bounded) shared set.
 */
export async function searchAccessibleDocs(
  userEmail: string,
  query: string,
  { limit = 50 }: { limit?: number } = {}
): Promise<ListDocsResult> {
  const user = normalizeEmail(userEmail)
  const q = query.trim()
  if (!q) return listAccessibleDocs(userEmail, { limit })

  const foldersPromise = getAccessibleFolders(user)
  const ownedPage = await searchObjectsPage<DocRow>("OrbitDocsList", {
    where: {
      type: "and",
      value: [
        // case-insensitive (term match); over-matches rejected below
        emailWhere("addedBy", user),
        { type: "eq", field: "isActive", value: true },
        { type: "containsAllTerms", field: "documentName", value: q },
      ],
    },
    orderBy: { fields: [{ field: "createdAt", direction: "desc" }] },
    select: DOC_LIST_FIELDS,
    pageSize: limit,
  })
  const folders = await foldersPromise
  const { sharedFolderNames, folderDocIds } = folderMembership(folders)

  const docsById = new Map<string, DocRow>()
  for (const doc of ownedPage.data.filter((d) => sameEmail(d.addedBy, user))) {
    docsById.set(pk(doc), doc)
  }

  // Folder-shared docs can't be term-searched upstream (no addedBy filter
  // would over-match); fetch the bounded shared set and substring-match.
  const missingShared = [...folderDocIds].filter((id) => !docsById.has(id))
  const SHARED_SEARCH_CAP = 500
  if (missingShared.length > 0 && missingShared.length <= SHARED_SEARCH_CAP) {
    const shared = await getObjectsByIds<DocRow>(
      "OrbitDocsList",
      "primaryKey_",
      missingShared
    )
    const needle = q.toLowerCase()
    for (const [id, doc] of shared) {
      if (doc.isActive === false) continue
      if (!(doc.documentName ?? "").toLowerCase().includes(needle)) continue
      docsById.set(id, doc)
    }
  }

  let docs = [...docsById.values()]
  docs.sort((a, b) => byCreatedAt(b, a))
  docs = docs.slice(0, limit)
  const indexStatus = await getIndexStatusForDocs(docs.map(pk))
  return { docs, sharedFolderNames, folders, indexStatus }
}

export async function createDocRow(params: {
  documentName: string
  reference: unknown
  noPages: number
  addedBy: string
}): Promise<void> {
  await applyAction("create-orbit-docs-list", {
    documentName: params.documentName,
    reference: params.reference,
    isIndexed: false,
    isActive: true,
    noPages: params.noPages,
    addedBy: normalizeEmail(params.addedBy),
    createdAt: now(),
  })
}

/** Soft-delete a doc, replaying required params (matches PoC edit action). */
export async function softDeleteDoc(doc: DocRow): Promise<void> {
  await applyAction("edit-orbit-docs-list", {
    OrbitDocsList: pk(doc),
    isActive: false,
    isIndexed: Boolean(doc.isIndexed),
    addedBy: normalizeEmail(doc.addedBy),
    documentName: doc.documentName ?? "",
    createdAt: doc.createdAt ?? now(),
    reference: doc.reference,
  })
}

export async function removeDocFromFolders(
  docId: string,
  folders: FolderRow[]
): Promise<string[]> {
  // Each folder edit targets a distinct row, so run them concurrently.
  const results = await Promise.all(
    folders.map(async (folder) => {
      const contents = (folder.contents ?? []).map(String)
      if (!contents.includes(docId)) return null
      await applyAction("edit-orbit-folders", {
        OrbitFolders: pk(folder),
        contents: contents.filter((id) => id !== docId),
        updatedAt: now(),
      })
      return folder.name ?? pk(folder)
    })
  )
  const removedFrom = results.filter((name): name is string => name !== null)
  if (removedFrom.length > 0) invalidateFolderCache()
  return removedFrom
}

export async function createFolder(params: {
  name: string
  createdBy: string
  color?: string
  accessEmails?: string[]
  contents?: string[]
}): Promise<string> {
  const creator = normalizeEmail(params.createdBy)
  const accessEmails = [
    creator,
    ...(params.accessEmails ?? []).flatMap((e) => {
      const email = normalizeEmail(e)
      return email !== creator ? [email] : []
    }),
  ]
  const response = await applyAction(
    "create-orbit-folders",
    {
      name: params.name,
      createdBy: creator,
      accessEmails,
      contents: params.contents ?? [],
      color: params.color,
      updatedAt: now(),
    },
    { returnEdits: true }
  )
  invalidateFolderCache()
  return extractCreatedPrimaryKey(response, "OrbitFolders")
}

export async function editFolder(
  folderId: string,
  fields: Partial<{
    name: string
    color: string
    accessEmails: string[]
    contents: string[]
  }>
): Promise<void> {
  await applyAction("edit-orbit-folders", {
    OrbitFolders: folderId,
    ...fields,
    updatedAt: now(),
  })
  invalidateFolderCache()
}

export async function deleteFolder(folderId: string): Promise<void> {
  await applyAction("delete-orbit-folders", { OrbitFolders: folderId })
  invalidateFolderCache()
}

/* ------------------------------------------------------------------ */
/* Sessions / messages / branches                                       */
/* ------------------------------------------------------------------ */

/** Columns needed to render the session list — projected to shrink payloads. */
const SESSION_LIST_FIELDS = [
  "primaryKey_",
  "title",
  "mode",
  "summary",
  "createdAt",
  "updatedAt",
  "isDeleted",
  "docsAttached",
  "foldersAttached",
  "chatFolderId",
  "activeBranchId",
  "defaultBranchId",
  "currentRunStatus",
  "user",
]

export async function listSessions(userEmail: string): Promise<SessionRow[]> {
  const rows = await searchObjects<SessionRow>("OrbitDocsUserSessions", {
    // case-insensitive (term match); over-matches rejected below
    where: emailWhere("user", userEmail),
    pageSize: 1000,
    select: SESSION_LIST_FIELDS,
  })
  // isDeleted is nullable — NULL means active, so filter in JS (PoC behavior)
  return rows
    .filter((row) => !row.isDeleted && sameEmail(row.user, userEmail))
    .sort((a, b) => {
      const ta = a.updatedAt ?? a.createdAt ?? ""
      const tb = b.updatedAt ?? b.createdAt ?? ""
      return ta < tb ? 1 : -1
    })
}

export async function getSessionRow(
  sessionId: string,
  userEmail: string
): Promise<SessionRow | null> {
  const row = await getObject<SessionRow>("OrbitDocsUserSessions", sessionId)
  if (!row || row.isDeleted) return null
  if (!sameEmail(row.user, userEmail)) return null
  return row
}

export async function getSessionMessages(sessionId: string): Promise<MessageRow[]> {
  const rows = await searchObjects<MessageRow>("OrbitSessionMessages", {
    where: { type: "eq", field: "sessionId", value: sessionId },
    pageSize: 2000,
  })
  return rows.sort(byCreatedAt)
}

export async function getSessionBranches(sessionId: string): Promise<BranchRow[]> {
  const rows = await searchObjects<BranchRow>("OrbitSessionBranches", {
    where: { type: "eq", field: "sessionId", value: sessionId },
    pageSize: 1000,
  })
  return rows
    .filter((row) => !row.isDeleted)
    .sort((a, b) => byCreatedAt(a, b))
}

export async function updateSessionRow(
  sessionId: string,
  fields: Record<string, unknown>
): Promise<SessionRow | null> {
  // Preserve attachments unless explicitly updating them (PoC semantics —
  // omitted optional action params would otherwise clear the arrays).
  const current = await getObject<SessionRow>("OrbitDocsUserSessions", sessionId)
  const params: Record<string, unknown> = {
    OrbitDocsUserSessions: sessionId,
    ...fields,
  }
  if (current) {
    if (!("docsAttached" in fields)) params.docsAttached = current.docsAttached ?? []
    if (!("foldersAttached" in fields))
      params.foldersAttached = current.foldersAttached ?? []
  }
  await applyAction("edit-orbit-docs-user-sessions", params)
  return getObject<SessionRow>("OrbitDocsUserSessions", sessionId)
}

export async function createSessionRow(params: {
  userEmail: string
  mode: string
  docsAttached: string[]
  foldersAttached: string[]
  agentRid: string
  agentVersion?: string | null
}): Promise<SessionRow> {
  const timestamp = now()
  const response = await applyAction(
    "create-orbit-docs-user-sessions",
    {
      user: normalizeEmail(params.userEmail),
      title: "New chat",
      createdAt: timestamp,
      updatedAt: timestamp,
      docsAttached: params.docsAttached,
      foldersAttached: params.foldersAttached,
      summary: "",
      currentSessionId: "",
      currentAgentRid: params.agentRid,
      currentAgentVersion: params.agentVersion ?? undefined,
      currentRunStatus: "idle",
      mode: normalizeMode(params.mode),
    },
    { returnEdits: true }
  )
  const sessionId = extractCreatedPrimaryKey(response, "OrbitDocsUserSessions")

  const branchId = await createBranchRow({
    sessionId,
    createdBy: params.userEmail,
    name: "main",
    isDefault: true,
    anchorMessageId: null,
  })
  const updated = await updateSessionRow(sessionId, {
    activeBranchId: branchId,
    defaultBranchId: branchId,
    updatedAt: now(),
  })
  if (!updated) throw new Error("Session vanished after creation")
  return updated
}

export async function createBranchRow(params: {
  sessionId: string
  createdBy: string
  name: string
  isDefault?: boolean
  anchorMessageId?: string | null
}): Promise<string> {
  const timestamp = now()
  const response = await applyAction(
    "create-orbit-session-branches",
    {
      sessionId: params.sessionId,
      createdBy: normalizeEmail(params.createdBy),
      name: params.name,
      createdAt: timestamp,
      updatedAt: timestamp,
      summary: "",
      isDefault: Boolean(params.isDefault),
      isDeleted: false,
      anchorMessageId: params.anchorMessageId || undefined,
      headMessageId: params.anchorMessageId || undefined,
    },
    { returnEdits: true }
  )
  return extractCreatedPrimaryKey(response, "OrbitSessionBranches")
}

/** Full-replay branch edit (edit action rewrites all provided params). */
export async function updateBranchRow(
  branch: BranchRow,
  fields: Partial<BranchRow>
): Promise<void> {
  await applyAction("edit-orbit-session-branches", {
    OrbitSessionBranches: pk(branch),
    sessionId: branch.sessionId,
    name: fields.name ?? branch.name ?? "main",
    createdBy: branch.createdBy,
    createdAt: branch.createdAt,
    summary: fields.summary ?? branch.summary ?? "",
    isDefault: fields.isDefault ?? Boolean(branch.isDefault),
    isDeleted: fields.isDeleted ?? Boolean(branch.isDeleted),
    deletedAt: fields.deletedAt ?? branch.deletedAt,
    anchorMessageId: fields.anchorMessageId ?? branch.anchorMessageId,
    headMessageId: fields.headMessageId ?? branch.headMessageId,
    updatedAt: now(),
  })
}

export async function createMessageRow(params: {
  sessionId: string
  message: string
  isAgent: boolean
  mode: string
  branchId?: string | null
  parentMessageId?: string | null
  branchIndex?: number
}): Promise<string> {
  const response = await applyAction(
    "create-orbit-session-messages",
    {
      sessionId: params.sessionId,
      message: params.message,
      isAgent: params.isAgent,
      title: "",
      createdAt: now(),
      mode: normalizeMode(params.mode),
      branchId: params.branchId ?? undefined,
      parentMessageId: params.parentMessageId ?? undefined,
      branchIndex: params.branchIndex,
    },
    { returnEdits: true }
  )
  return extractCreatedPrimaryKey(response, "OrbitSessionMessages")
}

/* ------------------------------------------------------------------ */
/* Attachment sanitization (PoC access rules)                           */
/* ------------------------------------------------------------------ */

export interface SanitizedAttachments {
  docsAttached: string[]
  foldersAttached: string[]
  /** effective document scope for agent turns (docs + folder contents) */
  scopedDocIds: string[]
}

export async function sanitizeAttachments(
  userEmail: string,
  requestedDocs: string[],
  requestedFolders: string[]
): Promise<SanitizedAttachments> {
  const user = normalizeEmail(userEmail)
  const folders = await getAccessibleFolders(user)
  const folderDocs = new Map<string, string[]>()
  const folderDocIds = new Set<string>()
  for (const folder of folders) {
    const docs = [...new Set((folder.contents ?? []).map(String))]
    folderDocs.set(pk(folder), docs)
    docs.forEach((id) => folderDocIds.add(id))
  }

  const sanitizedFolders: string[] = []
  const folderScope: string[] = []
  const scopeSeen = new Set<string>()
  for (const folderId of [...new Set(requestedFolders.map(String))]) {
    const docs = folderDocs.get(folderId)
    if (!docs) continue
    sanitizedFolders.push(folderId)
    for (const docId of docs) {
      if (scopeSeen.has(docId)) continue
      scopeSeen.add(docId)
      folderScope.push(docId)
    }
  }

  const uniqueDocs = [
    ...new Set(
      requestedDocs.flatMap((id) => {
        const s = String(id)
        return s ? [s] : []
      })
    ),
  ]
  const rows = await getObjectsByIds<DocRow>("OrbitDocsList", "primaryKey_", uniqueDocs)
  const sanitizedDocs: string[] = []
  for (const docId of uniqueDocs) {
    const doc = rows.get(docId)
    if (!doc || doc.isActive === false) continue
    if (normalizeEmail(doc.addedBy) === user || folderDocIds.has(docId)) {
      sanitizedDocs.push(docId)
    }
  }

  const scopedDocIds = [...new Set([...sanitizedDocs, ...folderScope])]
  return { docsAttached: sanitizedDocs, foldersAttached: sanitizedFolders, scopedDocIds }
}

/* ------------------------------------------------------------------ */
/* Chat folders (session folders — PoC chat_folders.py)                 */
/* ------------------------------------------------------------------ */

export const CHAT_FOLDER_COLORS = [
  "slate",
  "sky",
  "indigo",
  "teal",
  "emerald",
  "amber",
  "rose",
] as const

export function normalizeChatFolderColor(
  color: string | null | undefined
): string | null {
  const normalized = (color ?? "").trim().toLowerCase()
  if (!normalized) return null
  if (!(CHAT_FOLDER_COLORS as readonly string[]).includes(normalized)) {
    throw new Error(
      `Invalid folder color '${normalized}'. Allowed: ${CHAT_FOLDER_COLORS.join(", ")}`
    )
  }
  return normalized
}

export async function listChatFolders(userEmail: string): Promise<ChatFolderRow[]> {
  const rows = await searchObjects<ChatFolderRow>("OrbitChatFolders", {
    // case-insensitive (term match); over-matches rejected below
    where: emailWhere("createdBy", userEmail),
    pageSize: 1000,
  })
  // isDeleted is nullable — NULL means active, so filter in JS (PoC quirk).
  return rows
    .filter((row) => !row.isDeleted && sameEmail(row.createdBy, userEmail))
    .sort((a, b) => (a.name ?? "").toLowerCase().localeCompare((b.name ?? "").toLowerCase()))
}

export async function getChatFolder(folderId: string): Promise<ChatFolderRow | null> {
  const row = await getObject<ChatFolderRow>("OrbitChatFolders", folderId)
  if (!row || row.isDeleted) return null
  return row
}

export async function createChatFolder(params: {
  name: string
  color?: string | null
  createdBy: string
}): Promise<string> {
  const response = await applyAction(
    "create-orbit-chat-folders",
    {
      name: params.name.trim(),
      color: normalizeChatFolderColor(params.color) ?? undefined,
      createdBy: normalizeEmail(params.createdBy),
      updatedAt: now(),
    },
    { returnEdits: true }
  )
  return extractCreatedPrimaryKey(response, "OrbitChatFolders")
}

/** Full-replay edit (PoC edit_orbit_chat_folders rewrites all params). */
export async function updateChatFolder(
  folder: ChatFolderRow,
  fields: Partial<{ name: string; color: string | null; isDeleted: boolean; deletedAt: string }>
): Promise<void> {
  await applyAction("edit-orbit-chat-folders", {
    OrbitChatFolders: pk(folder),
    name: fields.name !== undefined ? fields.name.trim() : (folder.name ?? ""),
    color:
      fields.color !== undefined
        ? (normalizeChatFolderColor(fields.color) ?? undefined)
        : folder.color,
    createdBy: folder.createdBy,
    isDeleted: fields.isDeleted ?? Boolean(folder.isDeleted),
    deletedAt: fields.deletedAt ?? folder.deletedAt,
    updatedAt: now(),
  })
}

export async function softDeleteChatFolder(folder: ChatFolderRow): Promise<void> {
  await updateChatFolder(folder, { isDeleted: true, deletedAt: now() })
}

/** Active sessions filed in a chat folder (isDeleted nullable → JS filter). */
export async function listSessionsInChatFolder(
  folderId: string
): Promise<SessionRow[]> {
  const rows = await searchObjects<SessionRow>("OrbitDocsUserSessions", {
    where: { type: "eq", field: "chatFolderId", value: folderId },
    pageSize: 1000,
    select: ["primaryKey_", "isDeleted", "chatFolderId", "user"],
  })
  return rows.filter((row) => !row.isDeleted)
}

export function serializeChatFolder(row: ChatFolderRow) {
  return {
    primaryKey: pk(row),
    name: row.name ?? "",
    color: (CHAT_FOLDER_COLORS as readonly string[]).includes(row.color ?? "")
      ? row.color
      : null,
    createdBy: normalizeEmail(row.createdBy),
    updatedAt: row.updatedAt ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Sync sources                                                          */
/* ------------------------------------------------------------------ */

/** Sources change rarely but are consulted on every explorer call — cache. */
const SYNC_SOURCE_TTL_MS = 60_000
const syncSourceCache = new Map<string, ReturnType<typeof memoTTL<SyncSourceRow[]>>>()

export function invalidateSyncSourceCache(): void {
  for (const loader of syncSourceCache.values()) loader.invalidate()
}

export async function listSyncSources(userEmail: string): Promise<SyncSourceRow[]> {
  const user = normalizeEmail(userEmail)
  let loader = syncSourceCache.get(user)
  if (!loader) {
    loader = memoTTL(SYNC_SOURCE_TTL_MS, async () => {
      const rows = await searchObjects<SyncSourceRow>("OrbitSyncSource", {
        pageSize: 1000,
      })
      return rows.filter((row) => {
        const shared = (row.sharedWith ?? []).map(normalizeEmail)
        return sameEmail(row.ownerEmail, user) || shared.includes(user)
      })
    })
    syncSourceCache.set(user, loader)
  }
  return loader()
}

/* ------------------------------------------------------------------ */
/* Serialization (frontend payload shapes, matching the PoC API)        */
/* ------------------------------------------------------------------ */

export function serializeSession(row: SessionRow, messageCount = 0) {
  return {
    rid: pk(row),
    mode: normalizeMode(row.mode),
    chatFolderId: row.chatFolderId ?? null,
    activeBranchId: row.activeBranchId ?? null,
    defaultBranchId: row.defaultBranchId ?? null,
    isDeleted: Boolean(row.isDeleted),
    metadata: {
      title: row.title || "New chat",
      createdTime: row.createdAt ?? null,
      updatedTime: row.updatedAt ?? null,
      messageCount,
    },
    docsAttached: (row.docsAttached ?? []).map(String),
    foldersAttached: (row.foldersAttached ?? []).map(String),
    summary: row.summary ?? "",
    currentRun: {
      status: row.currentRunStatus || "idle",
      error: row.currentRunError ?? null,
      agentRid: row.currentAgentRid ?? null,
      agentVersion: row.currentAgentVersion ?? null,
      sessionId: row.currentSessionId ?? null,
      messageId: row.currentMessageId ?? null,
      sessionTraceId: row.currentSessionTraceId ?? null,
    },
  }
}

export function serializeMessage(row: MessageRow) {
  return {
    id: pk(row),
    role: row.isAgent ? ("assistant" as const) : ("user" as const),
    content: row.message ?? "",
    title: row.title ?? "",
    mode: normalizeMode(row.mode),
    createdAt: row.createdAt ?? null,
    parentMessageId: row.parentMessageId ?? null,
    branchId: row.branchId ?? null,
    branchIndex: row.branchIndex ?? null,
    hasAlternateBranches: row.hasAlternateBranches ?? null,
    alternateBranchCount: row.alternateBranchCount ?? null,
  }
}

export function serializeBranch(row: BranchRow) {
  return {
    id: pk(row),
    sessionId: row.sessionId ?? "",
    name: row.name ?? "",
    isDefault: Boolean(row.isDefault),
    anchorMessageId: row.anchorMessageId ?? null,
    headMessageId: row.headMessageId ?? null,
    summary: row.summary ?? "",
    updatedTime: row.updatedAt ?? null,
  }
}

/** Walk parent links back from the branch head (PoC linearize_branch_path). */
export function linearizeBranchPath(
  messages: MessageRow[],
  branch: BranchRow | undefined
): MessageRow[] {
  const head = branch?.headMessageId
  if (!head) return []
  const byId = new Map(messages.map((m) => [pk(m), m]))
  const path: MessageRow[] = []
  const visited = new Set<string>()
  let currentId: string = String(head)
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const message = byId.get(currentId)
    if (!message) break
    path.push(message)
    currentId = message.parentMessageId ? String(message.parentMessageId) : ""
  }
  return path.reverse()
}

export function serializeContent(
  messages: MessageRow[],
  session: SessionRow,
  branches: BranchRow[]
) {
  const activeBranch = branches.find((b) => pk(b) === session.activeBranchId)
  const ordered =
    activeBranch && activeBranch.headMessageId
      ? linearizeBranchPath(messages, activeBranch)
      : [...messages].sort(byCreatedAt)
  return {
    messages: ordered.map(serializeMessage),
    activeBranchId: session.activeBranchId ?? null,
    defaultBranchId: session.defaultBranchId ?? null,
    branches: branches.map(serializeBranch),
  }
}

export function serializeDoc(
  doc: DocRow,
  {
    sharedFolderNames,
    indexStatus,
    userEmail,
  }: {
    sharedFolderNames: Map<string, string[]>
    indexStatus: Map<string, IndexStatusRow>
    userEmail: string
  }
) {
  const id = pk(doc)
  const status = indexStatus.get(id)
  const isIndexed = status?.isIndexingComplete ?? Boolean(doc.isIndexed)
  const mediaReference = extractMediaItemRid(doc.reference)
  return {
    primaryKey: id,
    documentName: doc.documentName ?? "Untitled document",
    addedBy: normalizeEmail(doc.addedBy),
    isActive: doc.isActive !== false,
    isIndexed,
    isSharedFromFolder:
      normalizeEmail(doc.addedBy) !== normalizeEmail(userEmail) &&
      sharedFolderNames.has(id),
    sharedFolderNames: sharedFolderNames.get(id) ?? [],
    createdAt: doc.createdAt ?? null,
    // PoC precedence: the doc row's own page count wins; the index-status
    // row only fills in when the doc predates page counting.
    noPages: doc.noPages ?? status?.noPages ?? null,
    indexStatus: status
      ? {
          isIndexingComplete: Boolean(status.isIndexingComplete),
          embeddingCount: status.embeddingCount ?? null,
          lastUpdated: status.lastUpdated ?? null,
          noPages: status.noPages ?? null,
        }
      : null,
    isVLM: Boolean(doc.vlm),
    sourceType: doc.sourceType ?? null,
    sourceWebUrl: doc.sourceWebUrl ?? null,
    sourceSyncConfigPk: doc.sourceSyncConfigPk ?? null,
    mediaItemRid: mediaReference,
  }
}

/** Pull the media item RID out of a MediaReference property value. */
export function extractMediaItemRid(reference: unknown): string | null {
  if (!reference || typeof reference !== "object") return null
  const ref = reference as Record<string, unknown>
  const inner = (ref.reference ?? ref) as Record<string, unknown>
  const candidates = [
    inner.mediaItemRid,
    (inner.reference as Record<string, unknown> | undefined)?.mediaItemRid,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.startsWith("ri.")) {
      return candidate
    }
  }
  // deep fallback: find any ri.mio…media-item rid in the structure
  const text = JSON.stringify(reference)
  const match = text.match(/ri\.mio\.[a-z-]*\.media-item\.[a-zA-Z0-9-]+/)
  return match ? match[0] : null
}

export function serializeFolder(row: FolderRow) {
  return {
    primaryKey: pk(row),
    name: row.name ?? "Folder",
    color: row.color ?? null,
    createdBy: normalizeEmail(row.createdBy),
    accessEmails: (row.accessEmails ?? []).map(normalizeEmail),
    contents: (row.contents ?? []).map(String),
    updatedAt: row.updatedAt ?? null,
    isSyncManaged: Boolean(row.isSyncManaged),
    sourceSyncConfigPk: row.sourceSyncConfigPk ?? null,
  }
}

export function serializeSyncSource(row: SyncSourceRow) {
  return {
    primaryKey: pk(row),
    displayName: row.displayName ?? "Sync source",
    localRootPath: row.localRootPath ?? null,
    isActive: row.isActive !== false,
    lastSyncStatus: row.lastSyncStatus ?? null,
    lastSyncCompletedAt: row.lastSyncCompletedAt ?? null,
    errorCount: row.errorCount ?? 0,
    sourceWebUrl: row.sourceWebUrl ?? null,
    ownerEmail: normalizeEmail(row.ownerEmail),
    sharedWith: (row.sharedWith ?? []).flatMap((e) => {
      const email = normalizeEmail(e)
      return email ? [email] : []
    }),
  }
}

export function foundryUserEmail(): string {
  return getFoundryConfig().userEmail
}
