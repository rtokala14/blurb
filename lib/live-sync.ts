"use client"

import { liveApi } from "@/lib/live-api"
import { useOrbit } from "@/lib/store"

/**
 * Side-effects that keep Foundry in sync with store mutations in live mode.
 * Called from store actions so every UI call site stays unchanged.
 * All are best-effort/no-throw — the optimistic UI already updated.
 */

const scopeTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Debounced push of a session's document scope to Foundry. */
export function syncSessionScope(sessionId: string, docIds: string[]) {
  const session = useOrbit.getState().sessions.find((s) => s.id === sessionId)
  if (!session?.live) return // local placeholder — pushed on first send
  const existing = scopeTimers.get(sessionId)
  if (existing) clearTimeout(existing)
  scopeTimers.set(
    sessionId,
    setTimeout(() => {
      scopeTimers.delete(sessionId)
      void liveApi
        .updateSessionDocuments(sessionId, {
          docsAttached: docIds,
          foldersAttached: session.foldersAttached ?? [],
        })
        .catch(() => undefined)
    }, 600)
  )
}

export function syncDeleteSession(sessionId: string) {
  const session = useOrbit.getState().sessions.find((s) => s.id === sessionId)
  if (session && !session.live) return
  void liveApi.deleteSession(sessionId).catch(() => undefined)
}

export function syncDeleteDoc(docId: string) {
  void liveApi.deleteDoc(docId).catch(() => undefined)
}

/** Persist the active branch tip (leaf) after a local tree walk. */
export function syncSetActiveLeaf(sessionId: string, leafId: string) {
  const session = useOrbit.getState().sessions.find((s) => s.id === sessionId)
  // Only real server sessions have a persisted cursor; skip local placeholders.
  if (!session?.live || !leafId) return
  void liveApi.setActiveLeaf(sessionId, leafId).catch(() => undefined)
}

/** Move a doc into a folder (null = library root). */
export function syncMoveDoc(docId: string, folderId: string | null) {
  void liveApi.updateDoc(docId, { folderId }).catch(() => undefined)
}

/** Push a folder rename / reparent / share-list change to the server. */
export function syncUpdateFolder(
  folderId: string,
  body: Partial<{ name: string; parentId: string | null; accessEmails: string[] }>
) {
  void liveApi.updateFolder(folderId, body).catch(() => undefined)
}

/** Delete a folder server-side (force removes any nested contents mapping). */
export function syncDeleteFolder(folderId: string) {
  void liveApi.deleteFolder(folderId, true).catch(() => undefined)
}
