"use client"

import * as React from "react"
import { toast } from "sonner"

import { chatLineForDoc, isDocEnvelopeContent } from "@/lib/docgen/artifacts"
import { parseDocEnvelope, parseStreamingDoc } from "@/lib/docgen/parse"
import { getDocSkill } from "@/lib/docgen/skills"
import { liveApi, streamTurn } from "@/lib/live-api"
import { parseStreamingLiveText, parseLiveMessage } from "@/lib/live-citations"
import { liveCitationToUi } from "@/lib/live-map"
import { loadSessionContent } from "@/lib/live-session"
import { uid, useOrbit } from "@/lib/store"
import type { Artifact, ChatMessage } from "@/lib/types"

/**
 * Live chat driver against Foundry (same interface as useChatSimulation so
 * the workspace can swap them). Persisted state lives on the ontology; this
 * hook keeps optimistic UI + streaming state in the store.
 */
export function useLiveChat(sessionId: string) {
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  /** Load transcript + branches when a live session is opened. */
  const loadContent = React.useCallback(async (rid: string) => {
    try {
      await loadSessionContent(rid)
    } catch (error) {
      toast.error("Couldn't load the session transcript", {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }, [])

  /**
   * Poll the high-level thinking trace while a turn is in flight. The server
   * only ever returns tool labels + the agent's one-line thought — never raw
   * tool inputs/outputs — so this is safe to render directly.
   */
  const startTracePolling = React.useCallback(
    (rid: string, assistantMessageId: string, traceId: string) => {
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const tick = async () => {
        if (stopped) return
        try {
          const { status, steps } = await liveApi.trace(rid, traceId)
          if (stopped) return
          // Tool calls done but text not flowing yet — fill the dead air so
          // the indicator never freezes on the last trace line.
          const display =
            status === "COMPLETE"
              ? [
                ...steps,
                {
                  id: "trace-writing",
                  kind: "synthesize" as const,
                  label: "Writing the response…",
                },
              ]
              : steps
          if (display.length > 0) {
            useOrbit.getState().updateMessage(rid, assistantMessageId, (m) =>
              // once the reply is streaming/done, leave the message alone
              m.phase === "thinking" ? { thinking: display } : {}
            )
          }
        } catch {
          /* trace polling is best-effort — never surface errors */
        }
        if (!stopped) timer = setTimeout(tick, 2000)
      }
      timer = setTimeout(tick, 1200)
      return () => {
        stopped = true
        if (timer) clearTimeout(timer)
      }
    },
    []
  )

  /** Poll session metadata until the auto-title lands (bounded). */
  const pollTitle = React.useCallback((rid: string) => {
    let attempts = 0
    const tick = async () => {
      attempts += 1
      try {
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

  const send = React.useCallback(
    async (text: string, opts?: { docSkillId?: string }) => {
      const store = useOrbit.getState()
      let session = store.sessions.find((s) => s.id === sessionId)
      if (!session) return
      const docSkill = getDocSkill(opts?.docSkillId)
      if (session.scopeDocIds.length === 0) {
        toast.error("Select documents first", {
          description: "The agent only answers from documents in scope.",
        })
        return
      }

      // Optimistic UI: the user bubble + thinking placeholder land in the
      // store BEFORE any network round-trip (session creation can take
      // seconds), with a "sending" state until the server responds.
      const userMessageId = uid("lm")
      const assistantMessageId = uid("lm")
      const parentId = session.leafId
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
              : "Querying the Foundry agent across your documents",
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

      // Local placeholder session → create it on Foundry on first send
      // (messages survive the id swap).
      if (!session.live) {
        try {
          const created = await liveApi.createSession({
            docsAttached: session.scopeDocIds,
            foldersAttached: session.foldersAttached ?? [],
          })
          store.replaceSessionId(session.id, created.rid, {
            live: true,
            contentLoaded: true,
            activeBranchId: created.activeBranchId,
          })
          rid = created.rid
          session = useOrbit.getState().sessions.find((s) => s.id === rid)
          if (!session) return
        } catch (error) {
          useOrbit.getState().updateMessage(rid, userMessageId, { phase: "done" })
          useOrbit.getState().updateMessage(rid, assistantMessageId, {
            phase: "done",
            content: "*(couldn't reach Foundry — try sending again)*",
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
      // sent immediately rather than waiting for the first reply chunk —
      // otherwise "Sending…" lingers through the entire thinking phase.
      markUserSent()

      const sessionTraceId = crypto.randomUUID()
      const stopTracePolling = startTracePolling(rid, assistantMessageId, sessionTraceId)

      const finish = () => {
        stopTracePolling()
        setBusyId(null)
        abortRef.current = null
      }

      let lastParsedLength = 0
      // Throttle chat-text store writes: re-parsing the full accumulated
      // string + rebuilding the sessions array on EVERY chunk re-renders the
      // whole (non-virtualized) transcript per token. Coalesce to ~60ms; the
      // final content is always flushed by onComplete below, so nothing is
      // lost — this only drops intermediate frames the eye can't see anyway.
      const CHUNK_FLUSH_MS = 60
      let lastFlushAt = 0
      try {
        await streamTurn(
          rid,
          {
            userInput: text,
            branchId: session.activeBranchId ?? undefined,
            sessionTraceId,
            // "thinking" routes the turn to the deep-research agent
            mode: session.mode === "thinking" ? "thinking" : undefined,
            docSkillId: docSkill?.id,
          },
          {
            onChunk: (accumulated) => {
              // reply text is flowing — the thinking phase is over
              markUserSent()
              stopTracePolling()
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
              // Reconcile optimistic ids with persisted rows + fresh title.
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
    [sessionId, loadContent, pollTitle, startTracePolling]
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

  /** Branch from an assistant message (server-side), then reload transcript. */
  const branchFrom = React.useCallback(
    async (message: ChatMessage) => {
      try {
        const result = await liveApi.createBranch(sessionId, message.id)
        useOrbit.getState().patchSession(sessionId, {
          activeBranchId: result.activeBranchId,
        })
        await loadContent(sessionId)
        toast.success(`Branched: ${result.branch.name}`, {
          description: "New replies continue on this branch.",
        })
      } catch (error) {
        toast.error("Couldn't create the branch", {
          description: error instanceof Error ? error.message : undefined,
        })
      }
    },
    [sessionId, loadContent]
  )

  const activateBranch = React.useCallback(
    async (branchId: string) => {
      try {
        await liveApi.activateBranch(sessionId, branchId)
        useOrbit.getState().patchSession(sessionId, { activeBranchId: branchId })
        await loadContent(sessionId)
      } catch (error) {
        toast.error("Couldn't switch branches", {
          description: error instanceof Error ? error.message : undefined,
        })
      }
    },
    [sessionId, loadContent]
  )

  /**
   * Edit a past user message: branch at its parent (the reply before it),
   * switch to the branch, and send the edited text there. Pure composition
   * of the existing branches + continue REST surface.
   */
  const editAndBranch = React.useCallback(
    async (message: ChatMessage, newText: string) => {
      const text = newText.trim()
      if (!text) return
      if (!message.parentId) {
        toast("The first message can't be edited", {
          description: "Start a new session to ask something different.",
        })
        return
      }
      try {
        const result = await liveApi.createBranch(sessionId, message.parentId)
        useOrbit.getState().patchSession(sessionId, {
          activeBranchId: result.activeBranchId,
        })
        await loadContent(sessionId)
        await send(text)
        toast("Branched with your edit", {
          description: "The previous reply is still available via the branch switcher.",
        })
      } catch (error) {
        toast.error("Couldn't branch the conversation", {
          description: error instanceof Error ? error.message : undefined,
        })
      }
    },
    [sessionId, loadContent, send]
  )

  return React.useMemo(
    () => ({
      send,
      stop,
      busyId,
      isBusy: busyId !== null,
      loadContent,
      branchFrom,
      activateBranch,
      regenerate: branchFrom,
      editAndBranch,
    }),
    [send, stop, busyId, loadContent, branchFrom, activateBranch, editAndBranch]
  )
}
