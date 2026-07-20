"use client"

import { deriveDocArtifacts } from "@/lib/docgen/artifacts"
import { liveApi } from "@/lib/live-api"
import { transcriptToTree } from "@/lib/live-map"
import { useOrbit } from "@/lib/store"

/**
 * Load a live session's message tree into the store. Shared by the chat hook
 * (on open / after turns) and the sidebar hover prefetch, with in-flight
 * de-duplication so a hover followed by a click costs one fetch. Branches are
 * pure tree structure now (sibling groups) — the visible path is derived from
 * the active leaf.
 */
const inFlight = new Map<string, Promise<void>>()

export function loadSessionContent(rid: string): Promise<void> {
  const existing = inFlight.get(rid)
  if (existing) return existing
  const promise = (async () => {
    const content = await liveApi.content(rid)
    const tree = transcriptToTree(content.messages, content.activeLeafMessageId)
    // Envelope-bearing assistant messages become Studio artifacts; their
    // chat content collapses to a one-line summary + card.
    const derived = deriveDocArtifacts(rid, tree.messages)
    // Single store write → one render pass instead of three.
    useOrbit.getState().hydrateSessionContent({
      sessionId: rid,
      messages: derived.messages,
      leafId: tree.leafId,
      artifacts: derived.artifacts,
    })
  })().finally(() => inFlight.delete(rid))
  inFlight.set(rid, promise)
  return promise
}

/** Fire-and-forget warm for hover/focus — never throws, never re-fetches. */
export function prefetchSessionContent(rid: string): void {
  const session = useOrbit.getState().sessions.find((s) => s.id === rid)
  if (!session?.live || session.contentLoaded) return
  void loadSessionContent(rid).catch(() => undefined)
}
