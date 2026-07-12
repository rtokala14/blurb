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
  if (useOrbit.getState().live !== true) return
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
  if (useOrbit.getState().live !== true) return
  const session = useOrbit.getState().sessions.find((s) => s.id === sessionId)
  if (session && !session.live) return
  void liveApi.deleteSession(sessionId).catch(() => undefined)
}

export function syncDeleteDoc(docId: string) {
  if (useOrbit.getState().live !== true) return
  void liveApi.deleteDoc(docId).catch(() => undefined)
}
