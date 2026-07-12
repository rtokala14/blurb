"use client"

import { STREAM_ERROR_PREFIX } from "@/lib/foundry/turn"

/**
 * Client for the /api/orbit routes (which proxy Palantir Foundry).
 * Small typed fetch wrappers plus the streaming reader for chat turns.
 */

export interface LiveConfig {
  live: boolean
  hostname: string | null
  userEmail: string
  ontology: string
  isAdmin?: boolean
}

export interface LiveDocument {
  primaryKey: string
  documentName: string
  addedBy: string
  isActive: boolean
  isIndexed: boolean
  isSharedFromFolder: boolean
  sharedFolderNames: string[]
  createdAt: string | null
  noPages: number | null
  indexStatus: {
    isIndexingComplete: boolean
    embeddingCount: number | null
    lastUpdated: string | null
    noPages: number | null
  } | null
  isVLM: boolean
  sourceType: string | null
  sourceWebUrl: string | null
  sourceSyncConfigPk: string | null
  mediaItemRid: string | null
}

export interface LiveFolder {
  primaryKey: string
  name: string
  color: string | null
  createdBy: string
  accessEmails: string[]
  contents: string[]
  updatedAt: string | null
  isSyncManaged: boolean
  sourceSyncConfigPk: string | null
}

export interface LiveSession {
  rid: string
  mode: string
  chatFolderId: string | null
  activeBranchId: string | null
  defaultBranchId: string | null
  metadata: {
    title: string
    createdTime: string | null
    updatedTime: string | null
    messageCount: number
  }
  docsAttached: string[]
  foldersAttached: string[]
  summary: string
  currentRun: { status: string; error: string | null }
}

export interface LiveMessageRow {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: string | null
  parentMessageId: string | null
  branchId: string | null
  hasAlternateBranches: boolean | null
  alternateBranchCount: number | null
}

export interface LiveBranch {
  id: string
  sessionId: string
  name: string
  isDefault: boolean
  anchorMessageId: string | null
  headMessageId: string | null
}

export interface LiveContent {
  messages: LiveMessageRow[]
  branches?: LiveBranch[]
  activeBranchId?: string | null
  defaultBranchId?: string | null
}

export interface LiveSyncSource {
  primaryKey: string
  displayName: string
  isActive: boolean
  lastSyncStatus: string | null
  lastSyncCompletedAt: string | null
  errorCount: number
  sourceWebUrl: string | null
  ownerEmail: string
}

export interface LiveChatFolder {
  primaryKey: string
  name: string
  color: string | null
  createdBy: string
  updatedAt: string | null
}

export interface LiveBootstrap {
  userEmail: string
  documents: LiveDocument[]
  folders: LiveFolder[]
  sessions: LiveSession[]
  syncSources: LiveSyncSource[]
  chatFolders?: LiveChatFolder[]
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(data?.error ?? `${init?.method ?? "GET"} ${path} → ${res.status}`)
  }
  return (await res.json()) as T
}

export const liveApi = {
  config: () => apiJson<LiveConfig>("/api/orbit/config"),
  bootstrap: () => apiJson<LiveBootstrap>("/api/orbit/bootstrap"),
  docs: (limit?: number) =>
    apiJson<{ data: LiveDocument[] }>(
      `/api/orbit/docs${limit ? `?limit=${limit}` : ""}`
    ),
  searchDocs: (q: string, limit = 50) =>
    apiJson<{ data: LiveDocument[] }>(
      `/api/orbit/docs?q=${encodeURIComponent(q)}&limit=${limit}`
    ),
  docStatuses: (primaryKeys: string[]) =>
    apiJson<{
      data: { primaryKey: string; isIndexed: boolean; noPages: number | null }[]
    }>("/api/orbit/docs/status", {
      method: "POST",
      body: JSON.stringify({ primaryKeys }),
    }),
  deleteDoc: (pk: string) =>
    apiJson<{ success: boolean }>(`/api/orbit/docs/${encodeURIComponent(pk)}`, {
      method: "DELETE",
    }),
  uploadDocs: async (files: { file: File; name: string }[]) => {
    const form = new FormData()
    for (const { file, name } of files) {
      form.append("files", file)
      form.append("names", name)
    }
    const res = await fetch("/api/orbit/docs/upload", { method: "POST", body: form })
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean
      error?: string
      duplicates?: string[]
    }
    if (!res.ok) {
      if (res.status === 409 && data.duplicates?.length) {
        throw new Error(
          `Already in your library: ${data.duplicates.join(", ")}. Rename the ${
            data.duplicates.length === 1 ? "file" : "files"
          } or delete the existing ${
            data.duplicates.length === 1 ? "copy" : "copies"
          } first.`
        )
      }
      throw new Error(data.error ?? `Upload failed (${res.status})`)
    }
    return data
  },
  folders: () => apiJson<{ data: LiveFolder[] }>("/api/orbit/folders"),
  createFolder: (body: { name: string; color?: string }) =>
    apiJson<LiveFolder>("/api/orbit/folders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateFolder: (id: string, body: Partial<{ name: string; contents: string[] }>) =>
    apiJson<LiveFolder>(`/api/orbit/folders/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  sessions: () => apiJson<{ data: LiveSession[] }>("/api/orbit/sessions"),
  createSession: (body: { docsAttached?: string[]; foldersAttached?: string[] }) =>
    apiJson<LiveSession>("/api/orbit/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getSession: (rid: string) =>
    apiJson<LiveSession>(`/api/orbit/sessions/${encodeURIComponent(rid)}`),
  deleteSession: (rid: string) =>
    apiJson<{ success: boolean }>(`/api/orbit/sessions/${encodeURIComponent(rid)}`, {
      method: "DELETE",
    }),
  updateTitle: (rid: string, title: string) =>
    apiJson<LiveSession>(`/api/orbit/sessions/${encodeURIComponent(rid)}/title`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    }),
  updateSessionDocuments: (
    rid: string,
    body: { docsAttached: string[]; foldersAttached: string[] }
  ) =>
    apiJson<{ success: boolean }>(
      `/api/orbit/sessions/${encodeURIComponent(rid)}/documents`,
      { method: "PUT", body: JSON.stringify(body) }
    ),
  content: (rid: string) =>
    apiJson<LiveContent>(`/api/orbit/sessions/${encodeURIComponent(rid)}/content`),
  run: (rid: string) =>
    apiJson<{ status: string; error: string | null }>(
      `/api/orbit/sessions/${encodeURIComponent(rid)}/run`
    ),
  trace: (rid: string, traceId?: string) =>
    apiJson<{
      status: string
      steps: { id: string; kind: "search" | "read" | "analyze" | "tool"; label: string; detail?: string }[]
    }>(
      `/api/orbit/sessions/${encodeURIComponent(rid)}/trace${
        traceId ? `?traceId=${encodeURIComponent(traceId)}` : ""
      }`
    ),
  createBranch: (rid: string, anchorMessageId: string, name?: string) =>
    apiJson<{ activeBranchId: string; branch: LiveBranch }>(
      `/api/orbit/sessions/${encodeURIComponent(rid)}/branches`,
      { method: "POST", body: JSON.stringify({ anchorMessageId, name }) }
    ),
  activateBranch: (rid: string, branchId: string) =>
    apiJson<{ success: boolean }>(
      `/api/orbit/sessions/${encodeURIComponent(rid)}/branches/${encodeURIComponent(branchId)}/activate`,
      { method: "POST" }
    ),
  refine: (body: { userInput: string; toRefine?: string; refineRequest?: string }) =>
    apiJson<{ text: string }>("/api/orbit/refine", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  chatFolders: () =>
    apiJson<{ data: LiveChatFolder[] }>("/api/orbit/chat-folders"),
  createChatFolder: (body: { name: string; color?: string }) =>
    apiJson<LiveChatFolder>("/api/orbit/chat-folders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateChatFolder: (id: string, body: Partial<{ name: string; color: string | null }>) =>
    apiJson<LiveChatFolder>(`/api/orbit/chat-folders/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteChatFolder: (id: string, deleteSessions: boolean) =>
    apiJson<{
      success: boolean
      affectedSessionCount: number
      deletedSessionCount: number
      unfiledSessionCount: number
    }>(`/api/orbit/chat-folders/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({ deleteSessions }),
    }),
  assignSessionFolder: (sessionId: string, folderId: string | null) =>
    apiJson<{ success: boolean; folderId: string | null }>(
      `/api/orbit/sessions/${encodeURIComponent(sessionId)}/folder`,
      { method: "PUT", body: JSON.stringify({ folderId }) }
    ),

  syncBrowse: (sourceId: string, path: string) =>
    apiJson<SyncBrowseResponse>(
      `/api/orbit/sync/sources/${encodeURIComponent(sourceId)}/browse?path=${encodeURIComponent(path)}`
    ),
  syncSearch: (sourceId: string, q: string) =>
    apiJson<SyncBrowseResponse>(
      `/api/orbit/sync/sources/${encodeURIComponent(sourceId)}/search?q=${encodeURIComponent(q)}`
    ),
  syncFolderDocs: (sourceId: string, path: string) =>
    apiJson<{ path: string; docPks: string[]; count: number }>(
      `/api/orbit/sync/sources/${encodeURIComponent(sourceId)}/folder-docs?path=${encodeURIComponent(path)}`
    ),
}

export interface SyncEntry {
  name: string
  path: string
  isFolder: boolean
  orbitObjectPk: string | null
  syncStatus: string | null
  folderCount: number
  fileCount: number
}

export interface SyncBrowseResponse {
  path: string
  entries: SyncEntry[]
  total: number
  offset: number
  limit: number
  totalFiles: number
  totalFolders: number
}

export interface StreamTurnCallbacks {
  onChunk: (accumulated: string) => void
  onError: (payload: { type: string; title: string; message: string }) => void
  onComplete: (finalText: string) => void
}

/**
 * Stream a chat turn (plain text chunks; in-band errors carry the
 * __orbit_stream_error__: sentinel — buffered until disambiguated).
 */
export async function streamTurn(
  sessionRid: string,
  body: {
    userInput: string
    mode?: string
    branchId?: string | null
    messageId?: string
    sessionTraceId?: string
  },
  callbacks: StreamTurnCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(
    `/api/orbit/sessions/${encodeURIComponent(sessionRid)}/continue`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userInput: body.userInput,
        mode: body.mode ?? "regular",
        branchId: body.branchId ?? undefined,
        messageId: body.messageId ?? crypto.randomUUID(),
        sessionTraceId: body.sessionTraceId ?? crypto.randomUUID(),
      }),
      signal,
    }
  )
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    callbacks.onError({
      type: "error",
      title: "Request failed",
      message: data?.error ?? `HTTP ${res.status}`,
    })
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let accumulated = ""
  let emitted = false

  const mightBeSentinel = (text: string) =>
    STREAM_ERROR_PREFIX.startsWith(text) || text.startsWith(STREAM_ERROR_PREFIX)

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    accumulated += decoder.decode(value, { stream: true })
    // Hold back output while the prefix could still be the error sentinel.
    if (!emitted && mightBeSentinel(accumulated.trimStart())) {
      if (accumulated.trimStart().startsWith(STREAM_ERROR_PREFIX)) continue
      if (!accumulated.trim()) continue
    }
    emitted = true
    callbacks.onChunk(accumulated)
  }
  accumulated += decoder.decode()

  const trimmed = accumulated.trim()
  if (trimmed.startsWith(STREAM_ERROR_PREFIX)) {
    try {
      const payload = JSON.parse(trimmed.slice(STREAM_ERROR_PREFIX.length))
      callbacks.onError(payload)
    } catch {
      callbacks.onError({
        type: "error",
        title: "We couldn't finish that response",
        message: trimmed.slice(STREAM_ERROR_PREFIX.length),
      })
    }
    return
  }
  callbacks.onComplete(trimmed)
}

export interface AdminOverview {
  generatedAt: string
  days: number
  includeAdmins: boolean
  includeSynced: boolean
  totals: {
    users: number
    activeUsers: number
    admins: number
    unlimitedUsers: number
    usersNearQuota: number
    uploadsToday: number
    sessionsToday: number
    docsToday: number
    thinkingSessionsInRange: number
    corpus: {
      documents: number
      indexed: number
      indexedBase: number
      indexedPct: number
      syncedDocuments: number
      manualDocuments: number
      totalPages: number
    }
  }
  trends: { date: string; sessions: number; turns: number; documents: number; uniqueUsers: number }[]
  powerUsers: { email: string; name: string; isAdmin: boolean; sessions: number; turns: number; documents: number }[]
  usersNearQuota: AdminUser[]
}

export interface AdminUser {
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

export interface AdminSessionRow {
  rid: string
  title: string
  user: string
  mode: string
  createdAt: string | null
  updatedAt: string | null
  runStatus: string
}

export const adminApi = {
  overview: (opts: { days: number; includeAdmins: boolean; includeSynced: boolean }) =>
    apiJson<AdminOverview>(
      `/api/orbit/admin/overview?days=${opts.days}&includeAdmins=${opts.includeAdmins}&includeSynced=${opts.includeSynced}`
    ),
  users: () => apiJson<{ data: AdminUser[] }>("/api/orbit/admin/users"),
  updateUser: (
    pk: string,
    body: Partial<{
      name: string
      isAdmin: boolean
      isActive: boolean
      hasUnlimitedUploads: boolean
      dailyUploadLimit: number
      bonusUploadLimit: number
      bonusExpiresAt: string | null
    }>
  ) =>
    apiJson<{ success: boolean; data: AdminUser | null }>(
      `/api/orbit/admin/users/${encodeURIComponent(pk)}`,
      { method: "PUT", body: JSON.stringify(body) }
    ),
  sessions: (limit = 200) =>
    apiJson<{ data: AdminSessionRow[] }>(`/api/orbit/admin/sessions?limit=${limit}`),
}
