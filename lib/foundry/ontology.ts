import "server-only"

import {
  applyAction,
  extractCreatedPrimaryKey,
  getObject,
  getObjectsByIds,
  searchObjects,
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
 */
function memoTTL<T>(ttlMs: number, load: () => Promise<T>) {
  let value: { at: number; data: T } | null = null
  let inFlight: Promise<T> | null = null
  return async (): Promise<T> => {
    if (value && Date.now() - value.at < ttlMs) return value.data
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
}

const CACHE_TTL_MS = 5_000

const folderCacheByUser = new Map<string, () => Promise<FolderRow[]>>()

export async function getAccessibleFolders(userEmail: string): Promise<FolderRow[]> {
  const user = normalizeEmail(userEmail)
  let loader = folderCacheByUser.get(user)
  if (!loader) {
    loader = memoTTL(CACHE_TTL_MS, async () => {
      const [owned, shared] = await Promise.all([
        searchObjects<FolderRow>("OrbitFolders", {
          where: { type: "eq", field: "createdBy", value: user },
        }),
        searchObjects<FolderRow>("OrbitFolders", {
          where: { type: "contains", field: "accessEmails", value: user },
        }),
      ])
      const seen = new Set<string>()
      const folders: FolderRow[] = []
      for (const folder of [...owned, ...shared]) {
        const id = pk(folder)
        if (!id || seen.has(id)) continue
        seen.add(id)
        folders.push(folder)
      }
      return folders
    })
    folderCacheByUser.set(user, loader)
  }
  return loader()
}

const indexStatusCache = memoTTL(CACHE_TTL_MS, async () => {
  const rows = await searchObjects<IndexStatusRow>("OrbitDocIndexStatus", {
    pageSize: 2000,
    maxItems: 50_000,
    // Project only what serializeDoc needs — the reference/media columns on
    // this object are large and never used here.
    select: [
      "docKey",
      "isIndexingComplete",
      "embeddingCount",
      "lastUpdated",
      "noPages",
    ],
  })
  const map = new Map<string, IndexStatusRow>()
  for (const row of rows) {
    if (row.docKey) map.set(String(row.docKey), row)
  }
  return map
})

export function getIndexStatusMap(): Promise<Map<string, IndexStatusRow>> {
  return indexStatusCache()
}

export interface ListDocsResult {
  docs: DocRow[]
  /** doc pk -> folder names it is shared through */
  sharedFolderNames: Map<string, string[]>
  folders: FolderRow[]
  indexStatus: Map<string, IndexStatusRow>
}

/** Owned docs + docs shared via accessible folders (PoC /api/docs). */
export async function listAccessibleDocs(
  userEmail: string,
  { includeSynced = true }: { includeSynced?: boolean } = {}
): Promise<ListDocsResult> {
  const user = normalizeEmail(userEmail)
  const [folders, indexStatus, ownedDocs] = await Promise.all([
    getAccessibleFolders(user),
    getIndexStatusMap(),
    searchObjects<DocRow>("OrbitDocsList", {
      where: {
        type: "and",
        value: [
          { type: "eq", field: "addedBy", value: user },
          { type: "eq", field: "isActive", value: true },
        ],
      },
      pageSize: 1000,
    }),
  ])

  const sharedFolderNames = new Map<string, string[]>()
  const folderDocIds = new Set<string>()
  for (const folder of folders) {
    for (const docId of folder.contents ?? []) {
      const id = String(docId)
      folderDocIds.add(id)
      const names = sharedFolderNames.get(id) ?? []
      names.push(folder.name ?? "Folder")
      sharedFolderNames.set(id, names)
    }
  }

  const docsById = new Map<string, DocRow>()
  for (const doc of ownedDocs) docsById.set(pk(doc), doc)
  const missingShared = [...folderDocIds].filter((id) => !docsById.has(id))
  if (missingShared.length > 0) {
    const shared = await getObjectsByIds<DocRow>(
      "OrbitDocsList",
      "primaryKey_",
      missingShared
    )
    for (const [id, doc] of shared) {
      if (doc.isActive !== false) docsById.set(id, doc)
    }
  }

  let docs = [...docsById.values()]
  if (!includeSynced) {
    docs = docs.filter((d) => !(d.sourceType ?? "").trim())
  }
  docs.sort((a, b) => byCreatedAt(b, a))
  return { docs, sharedFolderNames, folders, indexStatus }
}

export async function getDoc(pkValue: string): Promise<DocRow | null> {
  return getObject<DocRow>("OrbitDocsList", pkValue)
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
  const removedFrom: string[] = []
  for (const folder of folders) {
    const contents = (folder.contents ?? []).map(String)
    if (!contents.includes(docId)) continue
    await applyAction("edit-orbit-folders", {
      OrbitFolders: pk(folder),
      contents: contents.filter((id) => id !== docId),
      updatedAt: now(),
    })
    removedFrom.push(folder.name ?? pk(folder))
  }
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
    ...(params.accessEmails ?? []).map(normalizeEmail).filter((e) => e !== creator),
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
}

export async function deleteFolder(folderId: string): Promise<void> {
  await applyAction("delete-orbit-folders", { OrbitFolders: folderId })
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
    where: { type: "eq", field: "user", value: normalizeEmail(userEmail) },
    pageSize: 1000,
    select: SESSION_LIST_FIELDS,
  })
  // isDeleted is nullable — NULL means active, so filter in JS (PoC behavior)
  return rows
    .filter((row) => !row.isDeleted)
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
  if (normalizeEmail(row.user) !== normalizeEmail(userEmail)) return null
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

  const uniqueDocs = [...new Set(requestedDocs.map(String).filter(Boolean))]
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
/* Sync sources                                                          */
/* ------------------------------------------------------------------ */

export async function listSyncSources(userEmail: string): Promise<SyncSourceRow[]> {
  const user = normalizeEmail(userEmail)
  const rows = await searchObjects<SyncSourceRow>("OrbitSyncSource", {
    pageSize: 1000,
  })
  return rows.filter((row) => {
    const owner = normalizeEmail(row.ownerEmail)
    const shared = (row.sharedWith ?? []).map(normalizeEmail)
    return owner === user || shared.includes(user)
  })
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
    noPages: status?.noPages ?? doc.noPages ?? null,
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
  }
}

export function foundryUserEmail(): string {
  return getFoundryConfig().userEmail
}
