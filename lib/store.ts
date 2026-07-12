"use client"

import { create } from "zustand"

import {
  seedActivity,
  seedArtifacts,
  seedDocs,
  seedFolders,
  seedSessions,
  seedSites,
} from "@/lib/data"
import {
  syncDeleteDoc,
  syncDeleteSession,
  syncSessionScope,
} from "@/lib/live-sync"
import type {
  ActivityItem,
  Artifact,
  ChatFolder,
  ChatMessage,
  ChatSession,
  Doc,
  DocFolder,
  SharePointSite,
} from "@/lib/types"

let idCounter = 0
export function uid(prefix: string) {
  idCounter += 1
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`
}

interface OrbitState {
  folders: DocFolder[]
  docs: Doc[]
  sessions: ChatSession[]
  artifacts: Artifact[]
  sites: SharePointSite[]
  activity: ActivityItem[]

  /** null = probing /api/orbit/config; false = demo simulation; true = Foundry */
  live: boolean | null
  liveUserEmail: string | null
  liveIsAdmin: boolean

  activeSessionId: string
  /** artifact currently open in the chat-side Studio panel (null = closed) */
  openArtifactId: string | null

  setLive: (live: boolean, userEmail?: string, isAdmin?: boolean) => void
  hydrateLive: (data: {
    docs: Doc[]
    folders: DocFolder[]
    sessions: ChatSession[]
    sites: SharePointSite[]
    chatFolders?: ChatFolder[]
  }) => void

  /* chat folders (live) */
  chatFolders: ChatFolder[]
  addChatFolder: (folder: ChatFolder) => void
  patchChatFolder: (id: string, patch: Partial<ChatFolder>) => void
  removeChatFolder: (id: string) => void
  /** swap a local temp session id for the server-issued rid */
  replaceSessionId: (oldId: string, newId: string, patch?: Partial<ChatSession>) => void
  patchSession: (id: string, patch: Partial<ChatSession>) => void
  setSessionTranscript: (
    id: string,
    messages: Record<string, ChatMessage>,
    leafId: string | null
  ) => void

  /* documents */
  addDoc: (doc: Doc) => void
  updateDoc: (id: string, patch: Partial<Doc>) => void
  removeDoc: (id: string) => void
  addFolder: (folder: DocFolder) => void
  renameFolder: (id: string, name: string) => void

  /* sharepoint */
  updateSite: (id: string, patch: Partial<SharePointSite>) => void

  /* activity */
  pushActivity: (item: Omit<ActivityItem, "id" | "time">) => void

  /* chat */
  setActiveSession: (id: string) => void
  createSession: (scopeDocIds?: string[]) => string
  renameSession: (id: string, title: string) => void
  deleteSession: (id: string) => void
  togglePinSession: (id: string) => void
  setSessionScope: (id: string, docIds: string[]) => void
  addMessage: (sessionId: string, message: ChatMessage, setAsLeaf?: boolean) => void
  updateMessage: (
    sessionId: string,
    messageId: string,
    patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)
  ) => void
  setLeaf: (sessionId: string, leafId: string) => void

  /* artifacts / studio */
  addArtifact: (artifact: Artifact) => void
  updateArtifact: (id: string, patch: Partial<Artifact>) => void
  setOpenArtifact: (id: string | null) => void
}

export const useOrbit = create<OrbitState>((set) => ({
  folders: seedFolders,
  docs: seedDocs,
  sessions: seedSessions,
  artifacts: seedArtifacts,
  sites: seedSites,
  activity: seedActivity,

  activeSessionId: seedSessions[0].id,
  openArtifactId: null,
  live: null,
  liveUserEmail: null,
  liveIsAdmin: false,

  setLive: (live, userEmail, isAdmin) =>
    set({ live, liveUserEmail: userEmail ?? null, liveIsAdmin: Boolean(isAdmin) }),
  hydrateLive: (data) =>
    set((s) => ({
      docs: data.docs,
      folders: data.folders,
      sessions: data.sessions,
      sites: data.sites,
      chatFolders: data.chatFolders ?? [],
      activeSessionId:
        data.sessions.find((x) => x.id === s.activeSessionId)?.id ??
        data.sessions[0]?.id ??
        "",
    })),

  chatFolders: [],
  addChatFolder: (folder) =>
    set((s) => ({
      chatFolders: [...s.chatFolders, folder].sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      ),
    })),
  patchChatFolder: (id, patch) =>
    set((s) => ({
      chatFolders: s.chatFolders
        .map((f) => (f.id === id ? { ...f, ...patch } : f))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
    })),
  removeChatFolder: (id) =>
    set((s) => ({
      chatFolders: s.chatFolders.filter((f) => f.id !== id),
      sessions: s.sessions.map((x) =>
        x.chatFolderId === id ? { ...x, chatFolderId: null } : x
      ),
    })),
  replaceSessionId: (oldId, newId, patch) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === oldId ? { ...x, ...patch, id: newId } : x
      ),
      activeSessionId: s.activeSessionId === oldId ? newId : s.activeSessionId,
    })),
  patchSession: (id, patch) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  setSessionTranscript: (id, messages, leafId) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, messages, leafId, contentLoaded: true } : x
      ),
    })),

  addDoc: (doc) => set((s) => ({ docs: [doc, ...s.docs] })),
  updateDoc: (id, patch) =>
    set((s) => ({
      docs: s.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })),
  removeDoc: (id) => {
    syncDeleteDoc(id)
    set((s) => ({ docs: s.docs.filter((d) => d.id !== id) }))
  },
  addFolder: (folder) => set((s) => ({ folders: [...s.folders, folder] })),
  renameFolder: (id, name) =>
    set((s) => ({
      folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)),
    })),

  updateSite: (id, patch) =>
    set((s) => ({
      sites: s.sites.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),

  pushActivity: (item) =>
    set((s) => ({
      activity: [
        { ...item, id: uid("act"), time: new Date().toISOString() },
        ...s.activity,
      ],
    })),

  setActiveSession: (id) => set({ activeSessionId: id, openArtifactId: null }),
  createSession: (scopeDocIds = []) => {
    const id = uid("s")
    const session: ChatSession = {
      id,
      title: "New session",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      leafId: null,
      messages: {},
      scopeDocIds,
    }
    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: id,
      openArtifactId: null,
    }))
    return id
  },
  renameSession: (id, title) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)),
    })),
  deleteSession: (id) => {
    syncDeleteSession(id)
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id)
      return {
        sessions,
        activeSessionId:
          s.activeSessionId === id
            ? (sessions[0]?.id ?? "")
            : s.activeSessionId,
      }
    })
  },
  togglePinSession: (id) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, pinned: !x.pinned } : x
      ),
    })),
  setSessionScope: (id, docIds) => {
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, scopeDocIds: docIds } : x
      ),
    }))
    syncSessionScope(id, docIds)
  },
  addMessage: (sessionId, message, setAsLeaf = true) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === sessionId
          ? {
              ...x,
              updatedAt: new Date().toISOString(),
              messages: { ...x.messages, [message.id]: message },
              leafId: setAsLeaf ? message.id : x.leafId,
            }
          : x
      ),
    })),
  updateMessage: (sessionId, messageId, patch) =>
    set((s) => ({
      sessions: s.sessions.map((x) => {
        if (x.id !== sessionId) return x
        const current = x.messages[messageId]
        if (!current) return x
        const resolved = typeof patch === "function" ? patch(current) : patch
        return {
          ...x,
          messages: { ...x.messages, [messageId]: { ...current, ...resolved } },
        }
      }),
    })),
  setLeaf: (sessionId, leafId) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === sessionId ? { ...x, leafId } : x
      ),
    })),

  addArtifact: (artifact) =>
    set((s) => ({ artifacts: [artifact, ...s.artifacts] })),
  updateArtifact: (id, patch) =>
    set((s) => ({
      artifacts: s.artifacts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),
  setOpenArtifact: (id) => set({ openArtifactId: id }),
}))

/* ------------------------------------------------------------------ */
/* Message-tree helpers                                                 */
/* ------------------------------------------------------------------ */

/** Active conversation path: walk up from the leaf, then reverse. */
export function activePath(session: ChatSession): ChatMessage[] {
  const path: ChatMessage[] = []
  let cursor = session.leafId ? session.messages[session.leafId] : undefined
  while (cursor) {
    path.push(cursor)
    cursor = cursor.parentId ? session.messages[cursor.parentId] : undefined
  }
  return path.reverse()
}

/** All sibling variants sharing this message's parent, oldest first. */
export function siblingsOf(
  session: ChatSession,
  message: ChatMessage
): ChatMessage[] {
  return Object.values(session.messages)
    .filter((m) => m.parentId === message.parentId && m.role === message.role)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Follow first-children down from a message to find the deepest leaf. */
export function deepestLeaf(session: ChatSession, fromId: string): string {
  let currentId = fromId
  for (;;) {
    const children = Object.values(session.messages)
      .filter((m) => m.parentId === currentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (children.length === 0) return currentId
    currentId = children[0].id
  }
}

export function countBranches(session: ChatSession): number {
  const parents = new Map<string | null, number>()
  for (const m of Object.values(session.messages)) {
    parents.set(m.parentId, (parents.get(m.parentId) ?? 0) + 1)
  }
  let extra = 0
  for (const [, count] of parents) if (count > 1) extra += count - 1
  return 1 + extra
}
