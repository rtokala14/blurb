"use client"

import { parseLiveMessage } from "@/lib/live-citations"
import type {
  LiveDocument,
  LiveFolder,
  LiveMessageRow,
  LiveSession,
  LiveSyncSource,
} from "@/lib/live-api"
import type {
  ChatFolder,
  ChatMessage,
  ChatSession,
  Citation,
  Doc,
  DocFolder,
  DocType,
  SharePointSite,
} from "@/lib/types"

/** Map Foundry payloads into the UI store's shapes. Pure — unit-tested. */

export function docTypeFromName(name: string): DocType {
  const ext = name.split(".").pop()?.toLowerCase()
  if (ext === "docx" || ext === "doc") return "docx"
  if (ext === "csv") return "csv"
  if (ext === "md") return "md"
  return "pdf"
}

export const SYNC_FOLDER_PREFIX = "sync:"

/**
 * v3 documents carry their real folder membership on `folderId` (null = root).
 * The optional `folderByDocId` map is kept for the legacy caller signature but
 * only used as a fallback when the server didn't resolve a folder.
 */
export function mapLiveDoc(
  doc: LiveDocument,
  folderByDocId?: Map<string, string>
): Doc {
  return {
    id: doc.primaryKey,
    name: doc.documentName,
    type: docTypeFromName(doc.documentName),
    folderId: doc.folderId ?? folderByDocId?.get(doc.primaryKey) ?? null,
    source: "upload",
    status: doc.isIndexed ? "ready" : "processing",
    sizeKB: 0,
    pages: doc.noPages ?? 0,
    owner: doc.addedBy,
    updatedAt: doc.createdAt ?? new Date().toISOString(),
    tags: doc.sharedFolderNames.slice(0, 3),
    summary: doc.isIndexed
      ? `Indexed${doc.noPages ? ` · ${doc.noPages} pages` : ""}. Ask about this document in Chat for grounded answers with citations.`
      : "Uploaded — extracting and indexing this document.",
    version: 1,
    mediaRid: doc.mediaItemRid,
  }
}

/**
 * v3 folders form a real nested tree via `parentId`. Colors are a client-side
 * preference (the server always sends null) so we carry whatever the payload
 * gives us and let local edits override it.
 */
export function mapLiveFolders(folders: LiveFolder[]): {
  folders: DocFolder[]
  folderByDocId: Map<string, string>
} {
  const mapped = folders.map((folder) => ({
    id: folder.primaryKey,
    name: folder.name,
    parentId: folder.parentId ?? null,
    source: "upload" as const,
    color: folder.color,
    createdBy: folder.createdBy,
    accessEmails: folder.accessEmails,
  }))
  // v3 resolves folder membership server-side on each doc, so there is no
  // per-folder contents list to invert here.
  return { folders: mapped, folderByDocId: new Map<string, string>() }
}

export function mapSyncSources(sources: LiveSyncSource[]): {
  folders: DocFolder[]
  sites: SharePointSite[]
} {
  const folders: DocFolder[] = sources.map((source) => ({
    id: `${SYNC_FOLDER_PREFIX}${source.primaryKey}`,
    name: source.displayName,
    parentId: null,
    source: "sharepoint",
    sharePointPath: source.sourceWebUrl ?? undefined,
  }))
  const sites: SharePointSite[] = sources.map((source) => ({
    id: source.primaryKey,
    name: source.displayName,
    url: source.sourceWebUrl ?? "",
    mappedFolderId: `${SYNC_FOLDER_PREFIX}${source.primaryKey}`,
    lastSyncedAt: source.lastSyncCompletedAt ?? new Date(0).toISOString(),
    docCount: 0,
    state: source.errorCount > 0 ? "attention" : "idle",
    attentionCount: source.errorCount,
    ownerEmail: source.ownerEmail,
    sharedWith: source.sharedWith ?? [],
    isActive: source.isActive,
  }))
  return { folders, sites }
}

export function mapLiveSession(session: LiveSession): ChatSession {
  return {
    id: session.rid,
    title: session.metadata.title,
    createdAt: session.metadata.createdTime ?? new Date().toISOString(),
    updatedAt: session.metadata.updatedTime ?? new Date().toISOString(),
    // messages aren't loaded until the transcript is fetched — the leaf is
    // derived from activeLeafMessageId then.
    leafId: null,
    messages: {},
    scopeDocIds: session.docsAttached,
    live: true,
    contentLoaded: false,
    foldersAttached: session.foldersAttached,
    runStatus: session.currentRun.status,
    chatFolderId: session.chatFolderId,
    mode: session.mode,
  }
}

export function mapLiveChatFolder(folder: {
  primaryKey: string
  name: string
  color: string | null
  updatedAt: string | null
}): ChatFolder {
  return {
    id: folder.primaryKey,
    name: folder.name,
    color: folder.color,
    updatedAt: folder.updatedAt,
  }
}

/** Convert a persisted transcript row into a store message (citations parsed). */
export function mapLiveMessage(row: LiveMessageRow): ChatMessage {
  const base: ChatMessage = {
    id: row.id,
    parentId: row.parentMessageId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt ?? new Date().toISOString(),
    phase: "done",
  }
  if (row.role === "assistant") {
    const parsed = parseLiveMessage(row.content)
    base.content = parsed.content
    base.citations = parsed.citations.map(liveCitationToUi)
  }
  return base
}

export function liveCitationToUi(citation: {
  n: number
  mediaRid: string
  docName: string
  pages: string
  firstPage: number
  quote?: string
}): Citation {
  return {
    n: citation.n,
    docId: "",
    page: citation.firstPage,
    quote: citation.quote ?? "",
    mediaRid: citation.mediaRid,
    docName: citation.docName,
    pagesLabel: citation.pages,
  }
}

/**
 * Build the full message tree from the transcript. v3 returns every message in
 * the session (not a single linearized branch); parent links come from
 * `parentMessageId`, and the active leaf is the session cursor. Sibling groups
 * (same parentId) power the version switcher; the visible path is derived by
 * walking up from the leaf (see `activePath` in the store).
 */
export function transcriptToTree(
  rows: LiveMessageRow[],
  activeLeafMessageId: string | null | undefined
): {
  messages: Record<string, ChatMessage>
  leafId: string | null
} {
  const messages: Record<string, ChatMessage> = {}
  let lastId: string | null = null
  for (const row of rows) {
    const message = mapLiveMessage(row)
    messages[message.id] = message
    lastId = message.id
  }
  // Prefer the server cursor; fall back to the last row for legacy sessions
  // that predate activeLeafMessageId being populated.
  const leafId =
    activeLeafMessageId && messages[activeLeafMessageId]
      ? activeLeafMessageId
      : lastId
  return { messages, leafId }
}
