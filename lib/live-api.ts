"use client"

import { STREAM_ERROR_PREFIX } from "@/lib/foundry/turn"

/**
 * Client for the /api/orbit routes (which proxy the Orbit Docs v3 pipeline).
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
  /** v3: real server-side nested folder membership (null = library root) */
  folderId: string | null
  status: string
  indexStatus: {
    isIndexingComplete: boolean
    embeddingCount: number | null
    entityCount: number | null
    kgReady: boolean
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
  /** v3: server always sends null — colors are a client-side preference */
  color: string | null
  /** v3: real nested-folder parent (null = top level) */
  parentId: string | null
  createdBy: string
  accessEmails: string[]
  updatedAt: string | null
}

export interface LiveSession {
  rid: string
  mode: "regular"
  chatFolderId: string | null
  isDeleted: boolean
  activeLeafMessageId: string | null
  metadata: {
    title: string
    createdTime: string | null
    updatedTime: string | null
    messageCount: number
  }
  docsAttached: string[]
  foldersAttached: string[]
  summary: string
  currentRun: {
    status: string
    error: string | null
    messageId: string | null
    startedAt: string | null
  }
}

export interface LiveMessageRow {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: string | null
  parentMessageId: string | null
  model: string | null
  citations: unknown[]
  scope: { documentIds?: string[]; folderIds?: string[] }
}

export interface LiveContent {
  /** the FULL message tree; the client derives the visible path */
  messages: LiveMessageRow[]
  activeLeafMessageId: string | null
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
  sharedWith?: string[]
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
  /** Move a doc between folders and/or update its explicit share list. */
  updateDoc: (
    pk: string,
    body: Partial<{ folderId: string | null; allowedUserIds: string[] }>
  ) =>
    apiJson<{ success: boolean; data: LiveDocument | null }>(
      `/api/orbit/docs/${encodeURIComponent(pk)}`,
      { method: "PUT", body: JSON.stringify(body) }
    ),
  uploadDocs: async (
    files: { file: File; name: string }[],
    folderId?: string | null
  ) => {
    const form = new FormData()
    for (const { file, name } of files) {
      form.append("files", file)
      form.append("names", name)
    }
    if (folderId) form.append("folderId", folderId)
    const res = await fetch("/api/orbit/docs/upload", { method: "POST", body: form })
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean
      error?: string
      duplicates?: string[]
      uploaded?: { primaryKey: string; documentName: string; noPages: number | null }[]
    }
    if (!res.ok) {
      if (res.status === 409 && data.duplicates?.length) {
        throw new Error(
          `Already in your library: ${data.duplicates.join(", ")}. Rename the ${data.duplicates.length === 1 ? "file" : "files"
          } or delete the existing ${data.duplicates.length === 1 ? "copy" : "copies"
          } first.`
        )
      }
      throw new Error(data.error ?? `Upload failed (${res.status})`)
    }
    return data
  },

  folders: () => apiJson<{ data: LiveFolder[] }>("/api/orbit/folders"),
  createFolder: (body: {
    name: string
    parentId?: string | null
    accessEmails?: string[]
  }) =>
    apiJson<LiveFolder>("/api/orbit/folders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateFolder: (
    id: string,
    body: Partial<{ name: string; parentId: string | null; accessEmails: string[] }>
  ) =>
    apiJson<LiveFolder>(`/api/orbit/folders/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteFolder: (id: string, force = true) =>
    apiJson<{ success: boolean }>(
      `/api/orbit/folders/${encodeURIComponent(id)}${force ? "?force=true" : ""}`,
      { method: "DELETE" }
    ),

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
    apiJson<{
      status: "idle" | "in_progress" | "failed"
      sessionId: string
      messageId: string | null
      error: string | null
      activeLeafMessageId: string | null
    }>(`/api/orbit/sessions/${encodeURIComponent(rid)}/run`),
  /** Persist which branch tip is the active leaf (pure tree op). */
  setActiveLeaf: (rid: string, messageId: string) =>
    apiJson<{ success: boolean; activeLeafMessageId: string }>(
      `/api/orbit/sessions/${encodeURIComponent(rid)}/leaf`,
      { method: "PUT", body: JSON.stringify({ messageId }) }
    ),
  refine: (body: {
    userInput: string
    toRefine?: string
    refineRequest?: string
    /** "llm-proxy" for lightweight tasks; defaults to the ontology query */
    engine?: "query" | "llm-proxy"
    provider?: "openai" | "anthropic"
    model?: string
  }) =>
    apiJson<{ text: string; engine?: string }>("/api/orbit/refine", {
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
}

export interface StreamTurnCallbacks {
  onChunk: (accumulated: string) => void
  onError: (payload: { type: string; title: string; message: string }) => void
  onComplete: (finalText: string) => void
}

/**
 * Stream a chat turn. The v3 pipeline returns the whole markdown reply as one
 * octet-stream chunk (no incremental tokens); in-band errors carry the
 * __orbit_stream_error__: sentinel — buffered until disambiguated. The reader
 * below handles both the single-chunk and (legacy) multi-chunk cases fine.
 */
export async function streamTurn(
  sessionRid: string,
  body: {
    userInput: string
    parentMessageId?: string | null
    personaId?: string | null
    docSkillId?: string | null
    docsAttached?: string[]
    foldersAttached?: string[]
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
        parentMessageId: body.parentMessageId ?? undefined,
        personaId: body.personaId ?? undefined,
        docSkillId: body.docSkillId ?? undefined,
        docsAttached: body.docsAttached ?? undefined,
        foldersAttached: body.foldersAttached ?? undefined,
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

  for (; ;) {
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
  totals: {
    users: number
    activeUsers: number
    admins: number
    usersNearQuota: number
    uploadsToday: number
    sessionsToday: number
    docsToday: number
    corpus: {
      documents: number
      indexed: number
      indexedBase: number
      indexedPct: number
      manualDocuments: number
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

export interface AdminGrant {
  primaryKey: string
  userEmail: string
  bonusUploads: number
  validFrom: string | null
  validUntil: string | null
  reason: string
  createdBy: string
  createdAt: string | null
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
  overview: (opts: { days: number; includeAdmins: boolean }) =>
    apiJson<AdminOverview>(
      `/api/orbit/admin/overview?days=${opts.days}&includeAdmins=${opts.includeAdmins}`
    ),
  users: () => apiJson<{ data: AdminUser[] }>("/api/orbit/admin/users"),
  updateUser: (
    pk: string,
    body: Partial<{
      name: string
      role: string
      isOnboarded: boolean
      isAllowedToUpload: boolean
      dailyUploadLimit: number
    }>
  ) =>
    apiJson<{ success: boolean; data: AdminUser | null }>(
      `/api/orbit/admin/users/${encodeURIComponent(pk)}`,
      { method: "PUT", body: JSON.stringify(body) }
    ),
  sessions: (limit = 200) =>
    apiJson<{ data: AdminSessionRow[] }>(`/api/orbit/admin/sessions?limit=${limit}`),
  grants: () => apiJson<{ data: AdminGrant[] }>("/api/orbit/admin/grants"),
  createGrant: (body: {
    userEmail: string
    bonusUploads: number
    validUntil: string
    validFrom?: string
    reason?: string
  }) =>
    apiJson<{ success: boolean; data: AdminGrant | null }>("/api/orbit/admin/grants", {
      method: "POST",
      body: JSON.stringify(body),
    }),
}
