import "server-only"

import {
  applyAction,
  extractCreatedPrimaryKey,
  getObject,
  getObjectsByIds,
  searchObjects,
  type MediaReference,
  type WhereClause,
} from "./client"
import { getFoundryConfig } from "./config"

/**
 * v3 ontology data layer (Orbit Docs v3 pipeline).
 *
 * Object types: OrbitDocsUserV2, OrbitDocsFolderRegistry, OrbitDocsDocMeta,
 * OrbitDocsChunks, OrbitDocsEntitiesCanonical, OrbitDocsRelationships,
 * OrbitDocsChatSessions, OrbitDocsChatMessages, OrbitDocsRateLimitGrants.
 *
 * Conventions (verified live):
 *  - All create actions generate the primary key server-side; extract it from
 *    apply-with-returnEdits responses.
 *  - Edit actions are full-replay: every parameter is rewritten, and the
 *    object-reference parameter is named like the object type.
 *  - Messages form a tree via parentMessageId; the session's
 *    activeLeafMessageId is the cursor. Branching = new sibling + repoint.
 *  - Session-level app state (scope, chat folder, agent session RID, run
 *    status) lives in the session's free-form `options` JSON.
 */

export const ROOT_FOLDER_ID = "folder-root"

/* ------------------------------------------------------------------ */
/* Row shapes (REST camelCase)                                          */
/* ------------------------------------------------------------------ */

export interface FolderRow {
  __primaryKey?: string
  folderId?: string
  name?: string
  parentFolderId?: string
  ownerUserId?: string
  allowedUserIds?: string[] | null
  createdTs?: string
}

export interface DocRow {
  __primaryKey?: string
  documentId?: string
  fileName?: string
  mime?: string
  mediaPath?: string
  mediaItemRid?: string
  mediaReference?: MediaReference
  parentFolderId?: string
  status?: string
  uploadTs?: string
  userEmail?: string
  allowedUserIds?: string[] | null
}

export interface SessionRow {
  __primaryKey?: string
  sessionId?: string
  userEmail?: string
  title?: string
  summary?: string
  options?: string
  createdAt?: string
  lastUpdatedAt?: string
  isDeleted?: boolean | null
  activeLeafMessageId?: string
}

export interface MessageRow {
  __primaryKey?: string
  messageId?: string
  sessionId?: string
  role?: string
  content?: string
  citations?: string
  scope?: string
  model?: string
  parentMessageId?: string
  createdAt?: string
  isDeleted?: boolean | null
}

export interface GrantRow {
  __primaryKey?: string
  grantId?: string
  userEmail?: string
  bonusUploads?: string | number
  validFrom?: string
  validUntil?: string
  reason?: string
  createdBy?: string
  createdAt?: string
}

export interface EntityRow {
  __primaryKey?: string
  entityId?: string
  documentId?: string
  canonicalName?: string
  type?: string
  mentionCount?: string | number
  chunkIds?: string[] | null
  userEmail?: string
}

export interface RelationshipRow {
  __primaryKey?: string
  relId?: string
  documentId?: string
  subjectEntityId?: string
  objectEntityId?: string
  predicate?: string
  weight?: string | number
  sourceChunkIds?: string[] | null
}

export interface ChunkRow {
  __primaryKey?: string
  chunkId?: string
  documentId?: string
  chunkContent?: string
  chunkMetadata?: string
  fileName?: string
  mediaItemRid?: string
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

export function pk(row: {
  __primaryKey?: unknown
  folderId?: unknown
  documentId?: unknown
  sessionId?: unknown
  messageId?: unknown
  grantId?: unknown
}): string {
  return String(
    row.__primaryKey ??
      row.folderId ??
      row.documentId ??
      row.sessionId ??
      row.messageId ??
      row.grantId ??
      ""
  )
}

export function normalizeEmail(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase()
}

export function sameEmail(a?: string | null, b?: string | null): boolean {
  const na = normalizeEmail(a)
  const nb = normalizeEmail(b)
  return na !== "" && na === nb
}

/**
 * Email equality filter. The search index lowercases terms, so
 * containsAllTerms matches regardless of stored casing — callers MUST
 * re-verify with sameEmail (over-match is possible on multi-term emails).
 */
export function emailWhere(field: string, email: string): WhereClause {
  return { type: "containsAllTerms", field, value: normalizeEmail(email) }
}

export function foundryUserEmail(): string {
  return getFoundryConfig().userEmail
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Read a row's free-form options JSON (never throws). */
export function parseOptions<T = Record<string, unknown>>(
  raw: string | undefined | null
): T {
  if (!raw) return {} as T
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as T) : ({} as T)
  } catch {
    return {} as T
  }
}

/** Session-level app state kept in ChatSessions.options JSON. */
export interface SessionOptions {
  docsAttached?: string[]
  foldersAttached?: string[]
  chatFolderId?: string | null
  /** AIP session RID returned by the main-agent query, for continuity */
  agentSessionRid?: string
  currentRun?: {
    status?: "idle" | "in_progress" | "failed"
    error?: string
    messageId?: string
    startedAt?: string
  }
}

export function sessionOptions(row: SessionRow): SessionOptions {
  return parseOptions<SessionOptions>(row.options)
}

/* ------------------------------------------------------------------ */
/* Folders (first-party nested tree)                                    */
/* ------------------------------------------------------------------ */

const FOLDER_CACHE_TTL_MS = 5_000
let folderCache: { email: string; rows: FolderRow[]; at: number } | null = null

export function invalidateFolderCache(): void {
  folderCache = null
}

/** Folders the user owns or is shared into (allowedUserIds). */
export async function getAccessibleFolders(
  userEmail: string
): Promise<FolderRow[]> {
  const email = normalizeEmail(userEmail)
  if (
    folderCache &&
    folderCache.email === email &&
    Date.now() - folderCache.at < FOLDER_CACHE_TTL_MS
  ) {
    return folderCache.rows
  }
  const rows = await searchObjects<FolderRow>("OrbitDocsFolderRegistry", {
    where: {
      type: "or",
      value: [
        emailWhere("ownerUserId", email),
        { type: "contains", field: "allowedUserIds", value: email },
      ],
    },
    pageSize: 1000,
  })
  const accessible = rows.filter(
    (row) =>
      sameEmail(row.ownerUserId, email) ||
      (row.allowedUserIds ?? []).some((entry) => sameEmail(entry, email))
  )
  folderCache = { email, rows: accessible, at: Date.now() }
  return accessible
}

export async function getFolder(folderId: string): Promise<FolderRow | null> {
  return getObject<FolderRow>("OrbitDocsFolderRegistry", folderId)
}

export async function createFolder(input: {
  name: string
  parentFolderId?: string | null
  ownerUserId: string
  allowedUserIds?: string[]
}): Promise<string> {
  const owner = normalizeEmail(input.ownerUserId)
  const allowed = [
    owner,
    ...(input.allowedUserIds ?? []).map(normalizeEmail).filter(Boolean),
  ]
  const response = await applyAction(
    "create-orbit-docs-folder-registry",
    {
      name: input.name,
      parentFolderId: input.parentFolderId || ROOT_FOLDER_ID,
      ownerUserId: owner,
      allowedUserIds: [...new Set(allowed)],
      createdTs: nowIso(),
    },
    { returnEdits: true }
  )
  invalidateFolderCache()
  return extractCreatedPrimaryKey(response, "OrbitDocsFolderRegistry")
}

/** Full-replay edit; unspecified fields keep the row's current values. */
export async function editFolder(
  folder: FolderRow,
  fields: Partial<{
    name: string
    parentFolderId: string
    allowedUserIds: string[]
  }>
): Promise<void> {
  await applyAction("edit-orbit-docs-folder-registry", {
    OrbitDocsFolderRegistry: pk(folder),
    name: fields.name ?? folder.name ?? "",
    parentFolderId:
      fields.parentFolderId ?? folder.parentFolderId ?? ROOT_FOLDER_ID,
    ownerUserId: normalizeEmail(folder.ownerUserId),
    allowedUserIds:
      fields.allowedUserIds ?? folder.allowedUserIds ?? undefined,
    createdTs: folder.createdTs ?? nowIso(),
  })
  invalidateFolderCache()
}

export async function deleteFolder(folderId: string): Promise<void> {
  await applyAction("delete-orbit-docs-folder-registry", {
    OrbitDocsFolderRegistry: folderId,
  })
  invalidateFolderCache()
}

export function serializeFolder(row: FolderRow) {
  return {
    primaryKey: pk(row),
    name: row.name ?? "",
    // v3 has no folder color — the UI keeps colors as a local preference
    color: null as string | null,
    parentId:
      !row.parentFolderId || row.parentFolderId === ROOT_FOLDER_ID
        ? null
        : row.parentFolderId,
    createdBy: normalizeEmail(row.ownerUserId),
    accessEmails: (row.allowedUserIds ?? []).map(normalizeEmail),
    updatedAt: row.createdTs ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Documents                                                            */
/* ------------------------------------------------------------------ */

export const DOC_LIST_LIMIT = 200

const DOC_LIST_FIELDS = [
  "documentId",
  "fileName",
  "mime",
  "mediaPath",
  "mediaItemRid",
  "mediaReference",
  "parentFolderId",
  "status",
  "uploadTs",
  "userEmail",
  "allowedUserIds",
]

function accessibleDocsWhere(email: string): WhereClause {
  return {
    type: "or",
    value: [
      emailWhere("userEmail", email),
      { type: "contains", field: "allowedUserIds", value: normalizeEmail(email) },
    ],
  }
}

export function canAccessDoc(doc: DocRow, email: string): boolean {
  return (
    sameEmail(doc.userEmail, email) ||
    (doc.allowedUserIds ?? []).some((entry) => sameEmail(entry, email))
  )
}

export async function listAccessibleDocs(
  userEmail: string,
  { limit = DOC_LIST_LIMIT }: { limit?: number } = {}
): Promise<{ docs: DocRow[]; hasMore: boolean }> {
  const rows = await searchObjects<DocRow>("OrbitDocsDocMeta", {
    where: accessibleDocsWhere(userEmail),
    orderBy: { fields: [{ field: "uploadTs", direction: "desc" }] },
    select: DOC_LIST_FIELDS,
    pageSize: Math.min(limit + 1, 1000),
    maxItems: limit + 1,
  })
  const docs = rows.filter((row) => canAccessDoc(row, userEmail))
  return { docs: docs.slice(0, limit), hasMore: docs.length > limit }
}

export async function searchAccessibleDocs(
  userEmail: string,
  query: string,
  { limit = 50 }: { limit?: number } = {}
): Promise<DocRow[]> {
  const rows = await searchObjects<DocRow>("OrbitDocsDocMeta", {
    where: {
      type: "and",
      value: [
        accessibleDocsWhere(userEmail),
        { type: "containsAllTerms", field: "fileName", value: query },
      ],
    },
    select: DOC_LIST_FIELDS,
    pageSize: limit,
    maxItems: limit,
  })
  return rows.filter((row) => canAccessDoc(row, userEmail))
}

export async function getDoc(docId: string): Promise<DocRow | null> {
  return getObject<DocRow>("OrbitDocsDocMeta", docId)
}

export async function getDocsByIds(ids: string[]): Promise<Map<string, DocRow>> {
  return getObjectsByIds<DocRow>("OrbitDocsDocMeta", "documentId", ids)
}

/**
 * Register an uploaded media item in the Document Registry. The media
 * reference must come from a fresh uploadMedia() call; `mediaPath` is the
 * media-set join key the indexing schedule uses for attribution.
 */
export async function createDocRow(input: {
  fileName: string
  mime: string
  mediaPath: string
  mediaItemRid: string
  mediaReference: MediaReference
  parentFolderId?: string | null
  userEmail: string
  allowedUserIds?: string[]
}): Promise<string> {
  const email = normalizeEmail(input.userEmail)
  const allowed = [
    email,
    ...(input.allowedUserIds ?? []).map(normalizeEmail).filter(Boolean),
  ]
  const response = await applyAction(
    "create-orbit-docs-doc-meta",
    {
      fileName: input.fileName,
      mime: input.mime,
      mediaPath: input.mediaPath,
      mediaItemRid: input.mediaItemRid,
      mediaReference: input.mediaReference,
      parentFolderId: input.parentFolderId || ROOT_FOLDER_ID,
      status: "uploaded",
      uploadTs: nowIso(),
      userEmail: email,
      allowedUserIds: [...new Set(allowed)],
    },
    { returnEdits: true }
  )
  return extractCreatedPrimaryKey(response, "OrbitDocsDocMeta")
}

/** Full-replay edit (move between folders, share, status). */
export async function editDocRow(
  doc: DocRow,
  fields: Partial<{
    parentFolderId: string
    allowedUserIds: string[]
    status: string
    fileName: string
  }>
): Promise<void> {
  if (!doc.mediaReference) {
    throw new Error(`Doc ${pk(doc)} has no media reference; cannot edit`)
  }
  await applyAction("edit-orbit-docs-doc-meta", {
    OrbitDocsDocMeta: pk(doc),
    fileName: fields.fileName ?? doc.fileName ?? "",
    mime: doc.mime ?? "application/pdf",
    mediaPath: doc.mediaPath ?? "",
    mediaItemRid: doc.mediaItemRid ?? "",
    mediaReference: doc.mediaReference,
    parentFolderId: fields.parentFolderId ?? doc.parentFolderId ?? ROOT_FOLDER_ID,
    status: fields.status ?? doc.status ?? "uploaded",
    uploadTs: doc.uploadTs ?? nowIso(),
    userEmail: normalizeEmail(doc.userEmail),
    allowedUserIds: fields.allowedUserIds ?? doc.allowedUserIds ?? undefined,
  })
}

/** v3 has no isActive soft delete — deleting the registry row is final. */
export async function deleteDocRow(docId: string): Promise<void> {
  await applyAction("delete-orbit-docs-doc-meta", { OrbitDocsDocMeta: docId })
}

/* ------------------------------------------------------------------ */
/* Indexing progress (chunk/entity counts per document)                 */
/* ------------------------------------------------------------------ */

export interface IndexCounts {
  chunkCount: number
  entityCount: number
  relationshipCount: number
  /** Source page count from the materialized status object (null if unknown). */
  pageCount: number | null
  /** Pipeline stage, e.g. "indexed" (null if no status row yet). */
  stage: string | null
  isSearchable: boolean
}

interface DocStatusRow {
  documentId?: string
  mediaItemRid?: string
  chunkCount?: string | number
  entityCount?: string | number
  relationshipCount?: string | number
  pageCount?: string | number
  stage?: string
  isSearchable?: boolean
}

/** Foundry serializes Long properties as strings. */
const toCount = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const indexCountCache = new Map<string, { at: number; counts: IndexCounts }>()
const INDEX_COUNT_TTL_MS = 5_000

/**
 * Indexing is asynchronous (schedule-driven). A document is ready to chat
 * when it has chunks; its knowledge graph is ready when it has entities.
 *
 * Counts come from the materialized [Orbit Docs] Document Status object:
 * one batched object load per 100 docs instead of two aggregation scans
 * over the (large) chunk and entity tables. Status rows are looked up by
 * documentId first; pipeline-registered status rows key by fileName rather
 * than the app's UUID documentId, so any doc without a direct hit is
 * resolved through the shared mediaItemRid instead (verified live: both
 * identities carry the same media item RID). A doc with neither reads as
 * zero counts (not ready) — matching the prior aggregation behaviour.
 * DocumentStatus is a counts source only; access control stays on DocMeta,
 * whose allowedUserIds/userEmail are the email-based authority.
 */
type IndexCountsDoc = Pick<
  DocRow,
  "__primaryKey" | "documentId" | "mediaItemRid"
>

export async function getIndexCountsForDocs(
  docs: IndexCountsDoc[]
): Promise<Map<string, IndexCounts>> {
  const out = new Map<string, IndexCounts>()
  const missing = new Map<string, IndexCountsDoc>()
  const now = Date.now()
  for (const doc of docs) {
    const id = pk(doc)
    if (!id || out.has(id) || missing.has(id)) continue
    const cached = indexCountCache.get(id)
    if (cached && now - cached.at < INDEX_COUNT_TTL_MS) {
      out.set(id, cached.counts)
    } else {
      missing.set(id, doc)
    }
  }
  if (missing.size > 0) {
    const statuses = await getObjectsByIds<DocStatusRow>(
      "OrbitDocsDocumentStatus",
      "documentId",
      [...missing.keys()]
    )
    const unresolvedRids = [
      ...new Set(
        [...missing.entries()]
          .filter(([id, doc]) => !statuses.has(id) && doc.mediaItemRid)
          .map(([, doc]) => String(doc.mediaItemRid))
      ),
    ]
    const byRid =
      unresolvedRids.length > 0
        ? await getObjectsByIds<DocStatusRow>(
            "OrbitDocsDocumentStatus",
            "mediaItemRid",
            unresolvedRids
          )
        : new Map<string, DocStatusRow>()
    for (const [id, doc] of missing) {
      const row =
        statuses.get(id) ??
        (doc.mediaItemRid ? byRid.get(String(doc.mediaItemRid)) : undefined)
      const counts: IndexCounts = {
        chunkCount: toCount(row?.chunkCount),
        entityCount: toCount(row?.entityCount),
        relationshipCount: toCount(row?.relationshipCount),
        pageCount: row?.pageCount != null ? toCount(row.pageCount) : null,
        stage: row?.stage ?? null,
        isSearchable: Boolean(row?.isSearchable),
      }
      indexCountCache.set(id, { at: now, counts })
      out.set(id, counts)
    }
  }
  return out
}

/** appPk -> chunk-owning documentId; the mapping is stable once indexed. */
const chunkOwnerCache = new Map<string, { at: number; owner: string }>()
const CHUNK_OWNER_TTL_MS = 5 * 60_000

/**
 * Resolve the documentId that actually owns each doc's chunks — the identity
 * the agent's retrieval joins on. Pipeline-registered rows own their chunks
 * under their own id; app-registered (UUID) rows are re-keyed to the
 * pipeline's fileName-keyed identity through the shared mediaItemRid on the
 * status object. Docs with no status row yet (still indexing) keep their own
 * id — there is nothing to retrieve under either identity — and are not
 * cached so they re-resolve as soon as indexing lands.
 */
export async function resolveChunkOwnerIds(
  docs: IndexCountsDoc[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const missing = new Map<string, IndexCountsDoc>()
  const now = Date.now()
  for (const doc of docs) {
    const id = pk(doc)
    if (!id || out.has(id) || missing.has(id)) continue
    const cached = chunkOwnerCache.get(id)
    if (cached && now - cached.at < CHUNK_OWNER_TTL_MS) {
      out.set(id, cached.owner)
    } else {
      missing.set(id, doc)
    }
  }
  if (missing.size > 0) {
    const statuses = await getObjectsByIds<DocStatusRow>(
      "OrbitDocsDocumentStatus",
      "documentId",
      [...missing.keys()]
    )
    const unresolvedRids = [
      ...new Set(
        [...missing.entries()]
          .filter(([id, doc]) => !statuses.has(id) && doc.mediaItemRid)
          .map(([, doc]) => String(doc.mediaItemRid))
      ),
    ]
    const byRid =
      unresolvedRids.length > 0
        ? await getObjectsByIds<DocStatusRow>(
            "OrbitDocsDocumentStatus",
            "mediaItemRid",
            unresolvedRids
          )
        : new Map<string, DocStatusRow>()
    for (const [id, doc] of missing) {
      const viaRid = doc.mediaItemRid
        ? byRid.get(String(doc.mediaItemRid))
        : undefined
      const owner = statuses.has(id)
        ? id
        : viaRid?.documentId
          ? String(viaRid.documentId)
          : null
      if (owner) {
        chunkOwnerCache.set(id, { at: now, owner })
        out.set(id, owner)
      } else {
        out.set(id, id)
      }
    }
  }
  return out
}

/** Docs sitting in the given folders, filtered to what the user may read. */
export async function listDocsInFolders(
  folderIds: string[],
  userEmail: string
): Promise<DocRow[]> {
  const unique = [...new Set(folderIds.filter(Boolean))]
  if (unique.length === 0) return []
  const rows = await searchObjects<DocRow>("OrbitDocsDocMeta", {
    where: { type: "in", field: "parentFolderId", value: unique },
    select: DOC_LIST_FIELDS,
    pageSize: 1000,
  })
  return rows.filter((row) => canAccessDoc(row, userEmail))
}

export function serializeDoc(
  doc: DocRow,
  {
    indexCounts,
    sharedFolderNames = [],
    userEmail,
  }: {
    indexCounts?: IndexCounts | null
    sharedFolderNames?: string[]
    userEmail?: string
  } = {}
) {
  const id = pk(doc)
  const isIndexed = (indexCounts?.chunkCount ?? 0) > 0
  const noPages = indexCounts?.pageCount ?? null
  return {
    primaryKey: id,
    documentName: doc.fileName ?? id,
    addedBy: normalizeEmail(doc.userEmail),
    isActive: true,
    isIndexed,
    isSharedFromFolder:
      Boolean(userEmail) && !sameEmail(doc.userEmail, userEmail ?? ""),
    sharedFolderNames,
    createdAt: doc.uploadTs ?? null,
    noPages,
    folderId:
      !doc.parentFolderId || doc.parentFolderId === ROOT_FOLDER_ID
        ? null
        : doc.parentFolderId,
    status: doc.status ?? "uploaded",
    indexStatus: indexCounts
      ? {
          isIndexingComplete: isIndexed,
          embeddingCount: indexCounts.chunkCount,
          entityCount: indexCounts.entityCount,
          kgReady: indexCounts.entityCount > 0,
          lastUpdated: null as string | null,
          noPages,
        }
      : null,
    isVLM: false,
    sourceType: "",
    sourceWebUrl: null as string | null,
    sourceSyncConfigPk: null as string | null,
    mediaItemRid: doc.mediaItemRid ?? null,
    mime: doc.mime ?? "application/pdf",
  }
}

/* ------------------------------------------------------------------ */
/* Chat sessions & message tree                                         */
/* ------------------------------------------------------------------ */

const SESSION_LIST_FIELDS = [
  "sessionId",
  "userEmail",
  "title",
  "summary",
  "options",
  "createdAt",
  "lastUpdatedAt",
  "isDeleted",
  "activeLeafMessageId",
]

export async function listSessions(userEmail: string): Promise<SessionRow[]> {
  const rows = await searchObjects<SessionRow>("OrbitDocsChatSessions", {
    where: emailWhere("userEmail", userEmail),
    select: SESSION_LIST_FIELDS,
    pageSize: 1000,
  })
  return rows
    .filter(
      (row) => sameEmail(row.userEmail, userEmail) && row.isDeleted !== true
    )
    .sort((a, b) =>
      String(b.lastUpdatedAt ?? b.createdAt ?? "").localeCompare(
        String(a.lastUpdatedAt ?? a.createdAt ?? "")
      )
    )
}

export async function getSessionRow(
  sessionId: string,
  userEmail: string
): Promise<SessionRow | null> {
  const row = await getObject<SessionRow>("OrbitDocsChatSessions", sessionId)
  if (!row || row.isDeleted === true) return null
  if (!sameEmail(row.userEmail, userEmail)) return null
  return row
}

export async function createSessionRow(input: {
  userEmail: string
  title?: string
  options?: SessionOptions
}): Promise<string> {
  const response = await applyAction(
    "create-orbit-docs-chat-sessions",
    {
      userEmail: normalizeEmail(input.userEmail),
      title: input.title ?? "New chat",
      summary: "",
      options: JSON.stringify(input.options ?? {}),
      createdAt: nowIso(),
      lastUpdatedAt: nowIso(),
      isDeleted: false,
      activeLeafMessageId: "",
    },
    { returnEdits: true }
  )
  return extractCreatedPrimaryKey(response, "OrbitDocsChatSessions")
}

/**
 * Full-replay session edit. Options patches merge into the current options
 * JSON so writers don't clobber unrelated keys they didn't touch.
 */
export async function updateSessionRow(
  session: SessionRow,
  fields: Partial<{
    title: string
    summary: string
    isDeleted: boolean
    activeLeafMessageId: string
    options: SessionOptions
  }>
): Promise<void> {
  const mergedOptions = fields.options
    ? { ...sessionOptions(session), ...fields.options }
    : sessionOptions(session)
  await applyAction("edit-orbit-docs-chat-sessions", {
    OrbitDocsChatSessions: pk(session),
    userEmail: normalizeEmail(session.userEmail),
    title: fields.title ?? session.title ?? "New chat",
    summary: fields.summary ?? session.summary ?? "",
    options: JSON.stringify(mergedOptions),
    createdAt: session.createdAt ?? nowIso(),
    lastUpdatedAt: nowIso(),
    isDeleted: fields.isDeleted ?? session.isDeleted ?? false,
    activeLeafMessageId:
      fields.activeLeafMessageId ?? session.activeLeafMessageId ?? "",
  })
}

export async function getSessionMessages(
  sessionId: string
): Promise<MessageRow[]> {
  const rows = await searchObjects<MessageRow>("OrbitDocsChatMessages", {
    where: { type: "eq", field: "sessionId", value: sessionId },
    pageSize: 2000,
  })
  return rows
    .filter((row) => row.isDeleted !== true)
    .sort((a, b) => {
      const at = String(a.createdAt ?? "")
      const bt = String(b.createdAt ?? "")
      return at === bt ? pk(a).localeCompare(pk(b)) : at.localeCompare(bt)
    })
}

export async function createMessageRow(input: {
  sessionId: string
  role: "user" | "assistant"
  content: string
  parentMessageId?: string | null
  scope?: { documentIds: string[]; folderIds: string[] }
  citations?: unknown[]
  model?: string
}): Promise<string> {
  const response = await applyAction(
    "create-orbit-docs-chat-messages",
    {
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      parentMessageId: input.parentMessageId ?? "",
      scope: JSON.stringify(input.scope ?? { documentIds: [], folderIds: [] }),
      citations: JSON.stringify(input.citations ?? []),
      model: input.model ?? "",
      createdAt: nowIso(),
      isDeleted: false,
    },
    { returnEdits: true }
  )
  return extractCreatedPrimaryKey(response, "OrbitDocsChatMessages")
}

/** Walk parentMessageId links from a leaf to the root; returns root→leaf. */
export function linearizeMessagePath(
  messages: MessageRow[],
  leafMessageId: string | null | undefined
): MessageRow[] {
  const byId = new Map(messages.map((m) => [pk(m), m]))
  const path: MessageRow[] = []
  const seen = new Set<string>()
  let cursor = leafMessageId ? byId.get(leafMessageId) : undefined
  while (cursor) {
    const id = pk(cursor)
    if (seen.has(id)) break
    seen.add(id)
    path.push(cursor)
    cursor = cursor.parentMessageId
      ? byId.get(cursor.parentMessageId)
      : undefined
  }
  return path.reverse()
}

export function serializeMessage(row: MessageRow) {
  let citations: unknown[] = []
  try {
    const parsed = JSON.parse(row.citations ?? "[]")
    if (Array.isArray(parsed)) citations = parsed
  } catch {
    // tolerate malformed rows
  }
  return {
    id: pk(row),
    role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: row.content ?? "",
    createdAt: row.createdAt ?? null,
    parentMessageId: row.parentMessageId || null,
    model: row.model || null,
    citations,
    scope: parseOptions<{ documentIds?: string[]; folderIds?: string[] }>(
      row.scope
    ),
  }
}

export function serializeSession(row: SessionRow, messageCount = 0) {
  const options = sessionOptions(row)
  return {
    rid: pk(row),
    mode: "regular" as const,
    chatFolderId: options.chatFolderId ?? null,
    isDeleted: row.isDeleted === true,
    activeLeafMessageId: row.activeLeafMessageId || null,
    metadata: {
      title: row.title ?? "New chat",
      createdTime: row.createdAt ?? null,
      updatedTime: row.lastUpdatedAt ?? null,
      messageCount,
    },
    docsAttached: options.docsAttached ?? [],
    foldersAttached: options.foldersAttached ?? [],
    summary: row.summary ?? "",
    currentRun: {
      status: options.currentRun?.status ?? "idle",
      error: options.currentRun?.error ?? null,
      messageId: options.currentRun?.messageId ?? null,
      startedAt: options.currentRun?.startedAt ?? null,
    },
  }
}

/** Full message tree + cursor; the client renders the active path. */
export function serializeContent(messages: MessageRow[], session: SessionRow) {
  return {
    messages: messages.map(serializeMessage),
    activeLeafMessageId: session.activeLeafMessageId || null,
  }
}

/* ------------------------------------------------------------------ */
/* Attachment sanitation (scope = docs + folders the user can read)     */
/* ------------------------------------------------------------------ */

export interface SanitizedAttachments {
  docsAttached: string[]
  foldersAttached: string[]
  removedDocs: string[]
  removedFolders: string[]
}

export async function sanitizeAttachments(
  userEmail: string,
  requestedDocs: string[],
  requestedFolders: string[]
): Promise<SanitizedAttachments> {
  const [folders, docs] = await Promise.all([
    getAccessibleFolders(userEmail),
    getDocsByIds(requestedDocs),
  ])
  const folderIds = new Set(folders.map((f) => pk(f)))
  const docsAttached: string[] = []
  const removedDocs: string[] = []
  for (const id of [...new Set(requestedDocs.filter(Boolean))]) {
    const doc = docs.get(id)
    if (doc && canAccessDoc(doc, userEmail)) docsAttached.push(id)
    else removedDocs.push(id)
  }
  const foldersAttached: string[] = []
  const removedFolders: string[] = []
  for (const id of [...new Set(requestedFolders.filter(Boolean))]) {
    if (folderIds.has(id)) foldersAttached.push(id)
    else removedFolders.push(id)
  }
  return { docsAttached, foldersAttached, removedDocs, removedFolders }
}

/* ------------------------------------------------------------------ */
/* Rate-limit grants                                                    */
/* ------------------------------------------------------------------ */

export async function listGrantsForUser(
  userEmail: string
): Promise<GrantRow[]> {
  const rows = await searchObjects<GrantRow>("OrbitDocsRateLimitGrants", {
    where: emailWhere("userEmail", userEmail),
    pageSize: 500,
  })
  return rows.filter((row) => sameEmail(row.userEmail, userEmail))
}

export async function listAllGrants(): Promise<GrantRow[]> {
  return searchObjects<GrantRow>("OrbitDocsRateLimitGrants", {
    pageSize: 2000,
    maxItems: 10_000,
  })
}

export function activeBonusUploads(
  grants: GrantRow[],
  at: Date = new Date()
): number {
  const now = at.getTime()
  let bonus = 0
  for (const grant of grants) {
    const from = Date.parse(grant.validFrom ?? "")
    const until = Date.parse(grant.validUntil ?? "")
    if (Number.isFinite(from) && now < from) continue
    if (Number.isFinite(until) && now > until) continue
    bonus += Number(grant.bonusUploads ?? 0) || 0
  }
  return bonus
}

export async function createGrantRow(input: {
  userEmail: string
  bonusUploads: number
  validFrom: string
  validUntil: string
  reason: string
  createdBy: string
}): Promise<string> {
  const response = await applyAction(
    "create-orbit-docs-v3rate-limit-grants",
    {
      userEmail: normalizeEmail(input.userEmail),
      bonusUploads: input.bonusUploads,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      reason: input.reason,
      createdBy: normalizeEmail(input.createdBy),
      createdAt: nowIso(),
    },
    { returnEdits: true }
  )
  return extractCreatedPrimaryKey(response, "OrbitDocsRateLimitGrants")
}

export function serializeGrant(row: GrantRow) {
  return {
    primaryKey: pk(row),
    userEmail: normalizeEmail(row.userEmail),
    bonusUploads: Number(row.bonusUploads ?? 0) || 0,
    validFrom: row.validFrom ?? null,
    validUntil: row.validUntil ?? null,
    reason: row.reason ?? "",
    createdBy: normalizeEmail(row.createdBy),
    createdAt: row.createdAt ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Knowledge graph reads (per document)                                 */
/* ------------------------------------------------------------------ */

export async function getDocEntities(docId: string): Promise<EntityRow[]> {
  return searchObjects<EntityRow>("OrbitDocsEntitiesCanonical", {
    where: { type: "eq", field: "documentId", value: docId },
    pageSize: 1000,
    maxItems: 5000,
  })
}

export async function getDocRelationships(
  docId: string
): Promise<RelationshipRow[]> {
  return searchObjects<RelationshipRow>("OrbitDocsRelationships", {
    where: { type: "eq", field: "documentId", value: docId },
    pageSize: 1000,
    maxItems: 5000,
  })
}
