"use client"

import * as React from "react"
import { toast } from "sonner"

import { chatLineForDoc, isDocEnvelopeContent } from "@/lib/docgen/artifacts"
import { parseDocEnvelope, parseStreamingDoc } from "@/lib/docgen/parse"
import { getDocSkill } from "@/lib/docgen/skills"
import { streamTurn } from "@/lib/live-api"
import { parseStreamingLiveText, parseLiveMessage } from "@/lib/live-citations"
import { liveCitationToUi } from "@/lib/live-map"
import { loadSessionContent } from "@/lib/live-session"
import { uid, useOrbit } from "@/lib/store"
import type { Artifact, ChatMessage } from "@/lib/types"

/**
 * Live chat driver against the v3 pipeline (same interface as
 * useChatSimulation so the workspace can swap them). Persisted state lives on
 * the ontology as a message tree; this hook keeps optimistic UI + streaming
 * state in the store.
 *
 * Branching is a pure tree op in v3: regenerate / edit-and-resend send a new
 * turn under the SAME parent as the original user message, so the server
 * creates a fresh sibling user+assistant pair and repoints the active leaf. No
 * branch objects, no thinking mode, no trace polling.
 */
export function useLiveChat(sessionId: string) {
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  /** Load the message tree when a live session is opened. */
  const loadContent = React.useCallback(async (rid: string) => {
    try {
      await loadSessionContent(rid)
    } catch (error) {
      toast.error("Couldn't load the session transcript", {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }, [])

  /** Poll session metadata until the auto-title lands (bounded). */
  const pollTitle = React.useCallback((rid: string) => {
    let attempts = 0
    const tick = async () => {
      attempts += 1
      try {
        const { liveApi } = await import("@/lib/live-api")
        const session = await liveApi.getSession(rid)
        const title = session.metadata.title
        if (title && title !== "New chat") {
          useOrbit.getState().patchSession(rid, { title })
          return
        }
      } catch {
        return
      }
      if (attempts < 8) setTimeout(tick, 2500)
    }
    setTimeout(tick, 2500)
  }, [])

  /**
   * Dispatch a turn under `parentMessageId` (null = a new root turn). Used for
   * a normal send (parent = current leaf), regenerate, and edit-and-resend.
   */
  const runTurn = React.useCallback(
    async (
      text: string,
      opts: { parentMessageId: string | null; docSkillId?: string }
    ) => {
      const store = useOrbit.getState()
      let session = store.sessions.find((s) => s.id === sessionId)
      if (!session) return
      const docSkill = getDocSkill(opts.docSkillId)
      if (session.scopeDocIds.length === 0) {
        toast.error("Select documents first", {
          description: "The agent only answers from documents in scope.",
        })
        return
      }

      // Optimistic UI: the user bubble + thinking placeholder land in the
      // store BEFORE any network round-trip (session creation can take
      // seconds), with a "sending" state until the server responds. The user
      // message hangs off `parentMessageId`, so regenerate/edit create a new
      // sibling group under the same parent.
      const userMessageId = uid("lm")
      const assistantMessageId = uid("lm")
      const parentId = opts.parentMessageId
      let rid = session.id
      store.addMessage(rid, {
        id: userMessageId,
        parentId,
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
        phase: "sending",
        scopeLabel: `${session.scopeDocIds.length} ${session.scopeDocIds.length === 1 ? "document" : "documents"
          } in scope`,
      })
      store.addMessage(rid, {
        id: assistantMessageId,
        parentId: userMessageId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        phase: "thinking",
        thinking: [
          {
            id: uid("t"),
            kind: docSkill ? "synthesize" : "search",
            label: docSkill
              ? `Drafting a ${docSkill.name} from your documents`
              : "Querying across your documents",
            docIds: session.scopeDocIds.slice(0, 4),
          },
        ],
      })
      setBusyId(assistantMessageId)
      let userMarkedSent = false
      const markUserSent = () => {
        if (userMarkedSent) return
        userMarkedSent = true
        useOrbit.getState().updateMessage(rid, userMessageId, { phase: "done" })
      }

      // Local placeholder session → create it on the server on first send
      // (messages survive the id swap).
      if (!session.live) {
        try {
          const { liveApi } = await import("@/lib/live-api")
          const created = await liveApi.createSession({
            docsAttached: session.scopeDocIds,
            foldersAttached: session.foldersAttached ?? [],
          })
          store.replaceSessionId(session.id, created.rid, {
            live: true,
            contentLoaded: true,
          })
          rid = created.rid
          session = useOrbit.getState().sessions.find((s) => s.id === rid)
          if (!session) return
        } catch (error) {
          useOrbit.getState().updateMessage(rid, userMessageId, { phase: "done" })
          useOrbit.getState().updateMessage(rid, assistantMessageId, {
            phase: "done",
            content: "*(couldn't reach the server — try sending again)*",
            errorType: "error",
            thinking: undefined,
          })
          setBusyId(null)
          toast.error("Couldn't create the session", {
            description: error instanceof Error ? error.message : undefined,
          })
          return
        }
      }
      // Generation turns get an optimistic artifact that streams into the
      // Studio panel; the chat shows its card instead of the raw envelope.
      let artifactId: string | null = null
      if (docSkill) {
        artifactId = uid("art")
        const artifact: Artifact = {
          id: artifactId,
          kind: "doc",
          title: docSkill.name,
          status: "generating",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceDocIds: session.scopeDocIds,
          sessionId: rid,
          docSkillId: docSkill.id,
          live: true,
        }
        store.addArtifact(artifact)
        store.setOpenArtifact(artifactId)
        useOrbit.getState().updateMessage(rid, assistantMessageId, {
          artifactIds: [artifactId],
        })
      }

      const controller = new AbortController()
      abortRef.current = controller

      // The turn is now dispatched to the server (the session exists and the
      // assistant thinking indicator takes over). Confirm the user bubble as
      // sent immediately rather than waiting for the reply.
      markUserSent()

      const finish = () => {
        setBusyId(null)
        abortRef.current = null
      }

      // v3 sends the whole reply as one chunk; still coalesce store writes in
      // case a proxy splits it, so we never re-render the transcript per byte.
      let lastParsedLength = 0
      const CHUNK_FLUSH_MS = 60
      let lastFlushAt = 0
      const personaId = useOrbit.getState().userProfile.personaId
      try {
        await streamTurn(
          rid,
          {
            userInput: text,
            parentMessageId: parentId,
            personaId,
            docSkillId: docSkill?.id,
            docsAttached: session.scopeDocIds,
            foldersAttached: session.foldersAttached ?? [],
          },
          {
            onChunk: (accumulated) => {
              // reply text is flowing — the thinking phase is over
              markUserSent()
              if (artifactId && docSkill) {
                // generation turn: stream into the artifact, not the chat
                useOrbit.getState().updateMessage(rid, assistantMessageId, {
                  phase: "streaming",
                })
                if (accumulated.length - lastParsedLength > 240) {
                  lastParsedLength = accumulated.length
                  const model = parseStreamingDoc(accumulated, {
                    fallbackTitle: docSkill.name,
                    fallbackDocType: docSkill.id,
                  })
                  useOrbit.getState().updateArtifact(artifactId, {
                    model,
                    title: model.meta.title,
                    updatedAt: new Date().toISOString(),
                  })
                }
                return
              }
              const now = Date.now()
              if (now - lastFlushAt < CHUNK_FLUSH_MS) return
              lastFlushAt = now
              const parsed = parseStreamingLiveText(accumulated)
              useOrbit.getState().updateMessage(rid, assistantMessageId, {
                phase: "streaming",
                content: parsed.content,
                citations: parsed.citations.map(liveCitationToUi),
              })
            },
            onError: (payload) => {
              markUserSent()
              if (artifactId) useOrbit.getState().removeArtifact(artifactId)
              useOrbit.getState().updateMessage(rid, assistantMessageId, {
                phase: "done",
                content:
                  payload.message ||
                  "Something went wrong while generating the answer.",
                errorType:
                  payload.type === "context_exceeded" ? "context_exceeded" : "error",
                thinking: undefined,
                artifactIds: undefined,
              })
              toast.error(payload.title || "Response failed", {
                description: payload.message,
              })
              finish()
            },
            onComplete: (finalText) => {
              markUserSent()
              if (artifactId && docSkill && isDocEnvelopeContent(finalText)) {
                const model = parseDocEnvelope(finalText, {
                  fallbackTitle: docSkill.name,
                  fallbackDocType: docSkill.id,
                })
                useOrbit.getState().updateArtifact(artifactId, {
                  model,
                  title: model.meta.title,
                  status: "ready",
                  updatedAt: new Date().toISOString(),
                })
                useOrbit.getState().updateMessage(rid, assistantMessageId, {
                  phase: "done",
                  content: chatLineForDoc(model),
                  citations: [],
                })
              } else {
                // no envelope → treat as an ordinary reply (matches how the
                // transcript will be derived on reload)
                if (artifactId) useOrbit.getState().removeArtifact(artifactId)
                const parsed = parseLiveMessage(finalText)
                useOrbit.getState().updateMessage(rid, assistantMessageId, {
                  phase: "done",
                  content: parsed.content,
                  citations: parsed.citations.map(liveCitationToUi),
                  ...(artifactId ? { artifactIds: undefined } : {}),
                })
              }
              finish()
              // Reconcile optimistic ids with persisted rows + fresh leaf/title
              // (the server already repointed activeLeafMessageId).
              void loadContent(rid)
              const current = useOrbit.getState().sessions.find((s) => s.id === rid)
              if ((current?.title ?? "New chat") === "New chat" || current?.title === "New session") {
                pollTitle(rid)
              }
            },
          },
          controller.signal
        )
      } catch (error) {
        markUserSent()
        // stopped or dropped mid-generation: keep a partial draft if one
        // streamed in (run recovery / reload will supply the final version)
        if (artifactId) {
          const artifact = useOrbit
            .getState()
            .artifacts.find((a) => a.id === artifactId)
          if (artifact?.model && artifact.model.blocks.length > 0) {
            useOrbit.getState().updateArtifact(artifactId, { status: "ready" })
          } else {
            useOrbit.getState().removeArtifact(artifactId)
          }
        }
        if ((error as Error).name !== "AbortError") {
          useOrbit.getState().updateMessage(rid, assistantMessageId, {
            phase: "done",
            content: "*(connection lost — check the session again shortly)*",
            errorType: "error",
          })
        }
        finish()
      }
    },
    [sessionId, loadContent, pollTitle]
  )

  /** Ordinary send: continue from the current leaf. */
  const send = React.useCallback(
    async (text: string, opts?: { docSkillId?: string }) => {
      const session = useOrbit.getState().sessions.find((s) => s.id === sessionId)
      await runTurn(text, {
        parentMessageId: session?.leafId ?? null,
        docSkillId: opts?.docSkillId,
      })
    },
    [sessionId, runTurn]
  )

  const stop = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    if (busyId) {
      useOrbit.getState().updateMessage(sessionId, busyId, (m) => ({
        phase: "done",
        content: m.content || "*(stopped — the run may still finish server-side)*",
      }))
    }
    setBusyId(null)
  }, [busyId, sessionId])

  /**
   * Regenerate an assistant message: resend the user turn that produced it
   * under the same parent, so the server creates a new sibling pair and moves
   * the active leaf onto the fresh reply.
   */
  const regenerate = React.useCallback(
    async (message: ChatMessage) => {
      const session = useOrbit.getState().sessions.find((s) => s.id === sessionId)
      if (!session) return
      // Find the user message that prompted this assistant reply.
      const parentUser = message.parentId
        ? session.messages[message.parentId]
        : undefined
      if (!parentUser || parentUser.role !== "user") {
        toast("Can't regenerate this message")
        return
      }
      await runTurn(parentUser.content, {
        parentMessageId: parentUser.parentId,
        docSkillId: undefined,
      })
    },
    [sessionId, runTurn]
  )

  /**
   * Edit a past user message and resend: send the edited text under the same
   * parent as the original, creating a new sibling branch. The previous reply
   * stays reachable via the sibling version switcher.
   */
  const editAndBranch = React.useCallback(
    async (message: ChatMessage, newText: string) => {
      const text = newText.trim()
      if (!text) return
      await runTurn(text, { parentMessageId: message.parentId })
    },
    [runTurn]
  )

  return React.useMemo(
    () => ({
      send,
      stop,
      busyId,
      isBusy: busyId !== null,
      loadContent,
      regenerate,
      editAndBranch,
    }),
    [send, stop, busyId, loadContent, regenerate, editAndBranch]
  )
}
