"use client"

import { parseLiveMessage } from "@/lib/live-citations"
import type {
  LiveBranch,
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
  SessionBranchMeta,
  SharePointSite,
} from "@/lib/types"

/** Map Foundry payloads into the UI store's shapes. Pure — unit-tested. */

export function docTypeFromName(name: string): DocType {
  const ext = name.split(".").pop()?.toLowerCase()
  if (ext === "docx" || ext === "doc") return "docx"
  if (ext === "xlsx" || ext === "xls") return "xlsx"
  if (ext === "pptx" || ext === "ppt") return "pptx"
  if (ext === "csv") return "csv"
  if (ext === "md") return "md"
  return "pdf"
}

export const SYNC_FOLDER_PREFIX = "sync:"

export function mapLiveDoc(
  doc: LiveDocument,
  folderByDocId: Map<string, string>
): Doc {
  const synced = (doc.sourceType ?? "").trim().length > 0
  return {
    id: doc.primaryKey,
    name: doc.documentName,
    type: docTypeFromName(doc.documentName),
    folderId: synced
      ? doc.sourceSyncConfigPk
        ? `${SYNC_FOLDER_PREFIX}${doc.sourceSyncConfigPk}`
        : null
      : (folderByDocId.get(doc.primaryKey) ?? null),
    source: synced ? "sharepoint" : "upload",
    status: doc.isIndexed ? "ready" : "processing",
    sizeKB: 0,
    pages: doc.noPages ?? 0,
    owner: doc.addedBy,
    updatedAt: doc.createdAt ?? new Date().toISOString(),
    tags: doc.sharedFolderNames.slice(0, 3),
    summary: doc.isIndexed
      ? `Indexed on Foundry${doc.noPages ? ` · ${doc.noPages} pages` : ""}. Ask about this document in Chat for grounded answers with citations.`
      : "Uploaded — Foundry is extracting and indexing this document.",
    version: 1,
    mediaRid: doc.mediaItemRid,
  }
}

export function mapLiveFolders(folders: LiveFolder[]): {
  folders: DocFolder[]
  folderByDocId: Map<string, string>
} {
  const folderByDocId = new Map<string, string>()
  const mapped = folders.map((folder) => {
    for (const docId of folder.contents) {
      if (!folderByDocId.has(docId)) folderByDocId.set(docId, folder.primaryKey)
    }
    return {
      id: folder.primaryKey,
      name: folder.name,
      parentId: null,
      source: "upload" as const,
    }
  })
  return { folders: mapped, folderByDocId }
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
  }))
  return { folders, sites }
}

export function mapLiveSession(session: LiveSession): ChatSession {
  return {
    id: session.rid,
    title: session.metadata.title,
    createdAt: session.metadata.createdTime ?? new Date().toISOString(),
    updatedAt: session.metadata.updatedTime ?? new Date().toISOString(),
    leafId: null,
    messages: {},
    scopeDocIds: session.docsAttached,
    live: true,
    contentLoaded: false,
    foldersAttached: session.foldersAttached,
    activeBranchId: session.activeBranchId,
    runStatus: session.currentRun.status,
    chatFolderId: session.chatFolderId,
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

export function mapLiveBranch(branch: LiveBranch): SessionBranchMeta {
  return {
    id: branch.id,
    name: branch.name,
    isDefault: branch.isDefault,
    anchorMessageId: branch.anchorMessageId,
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
    alternateBranchCount: row.alternateBranchCount,
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
 * Build the messages record + leaf from a linearized transcript. Parent links
 * come from the server; the last row is the active leaf.
 */
export function transcriptToTree(rows: LiveMessageRow[]): {
  messages: Record<string, ChatMessage>
  leafId: string | null
} {
  const messages: Record<string, ChatMessage> = {}
  let previous: string | null = null
  for (const row of rows) {
    const message = mapLiveMessage(row)
    // Ensure lineage even if legacy rows lack parent ids.
    if (message.parentId === null && previous) message.parentId = previous
    messages[message.id] = message
    previous = message.id
  }
  return { messages, leafId: previous }
}
