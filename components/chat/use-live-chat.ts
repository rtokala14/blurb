"use client"

import * as React from "react"
import { toast } from "sonner"

import { liveApi, streamTurn } from "@/lib/live-api"
import { parseStreamingLiveText, parseLiveMessage } from "@/lib/live-citations"
import {
  liveCitationToUi,
  mapLiveBranch,
  transcriptToTree,
} from "@/lib/live-map"
import { uid, useOrbit } from "@/lib/store"
import type { ChatMessage } from "@/lib/types"

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
      const content = await liveApi.content(rid)
      const { messages, leafId } = transcriptToTree(content.messages)
      const store = useOrbit.getState()
      store.setSessionTranscript(rid, messages, leafId)
      store.patchSession(rid, {
        branches: (content.branches ?? []).map(mapLiveBranch),
        activeBranchId: content.activeBranchId ?? null,
      })
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
          const { steps } = await liveApi.trace(rid, traceId)
          if (stopped) return
          if (steps.length > 0) {
            useOrbit.getState().updateMessage(rid, assistantMessageId, (m) =>
              // once the reply is streaming/done, leave the message alone
              m.phase === "thinking" ? { thinking: steps } : {}
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
    async (text: string) => {
      const store = useOrbit.getState()
      let session = store.sessions.find((s) => s.id === sessionId)
      if (!session) return
      if (session.scopeDocIds.length === 0) {
        toast.error("Select documents first", {
          description: "The agent only answers from documents in scope.",
        })
        return
      }

      let rid = session.id
      // Local placeholder session → create it on Foundry on first send.
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
          toast.error("Couldn't create the session", {
            description: error instanceof Error ? error.message : undefined,
          })
          return
        }
      }

      const userMessageId = uid("lm")
      const assistantMessageId = uid("lm")
      const parentId = session.leafId
      store.addMessage(rid, {
        id: userMessageId,
        parentId,
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
        phase: "done",
        scopeLabel: `${session.scopeDocIds.length} ${
          session.scopeDocIds.length === 1 ? "document" : "documents"
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
            kind: "search",
            label: "Querying the Foundry agent across your documents",
            docIds: session.scopeDocIds.slice(0, 4),
          },
        ],
      })
      setBusyId(assistantMessageId)

      const controller = new AbortController()
      abortRef.current = controller

      const sessionTraceId = crypto.randomUUID()
      const stopTracePolling = startTracePolling(rid, assistantMessageId, sessionTraceId)

      const finish = () => {
        stopTracePolling()
        setBusyId(null)
        abortRef.current = null
      }

      try {
        await streamTurn(
          rid,
          {
            userInput: text,
            branchId: session.activeBranchId ?? undefined,
            sessionTraceId,
          },
          {
            onChunk: (accumulated) => {
              // reply text is flowing — the thinking phase is over
              stopTracePolling()
              const parsed = parseStreamingLiveText(accumulated)
              useOrbit.getState().updateMessage(rid, assistantMessageId, {
                phase: "streaming",
                content: parsed.content,
                citations: parsed.citations.map(liveCitationToUi),
              })
            },
            onError: (payload) => {
              useOrbit.getState().updateMessage(rid, assistantMessageId, {
                phase: "done",
                content:
                  payload.message ||
                  "Something went wrong while generating the answer.",
                errorType:
                  payload.type === "context_exceeded" ? "context_exceeded" : "error",
                thinking: undefined,
              })
              toast.error(payload.title || "Response failed", {
                description: payload.message,
              })
              finish()
            },
            onComplete: (finalText) => {
              const parsed = parseLiveMessage(finalText)
              useOrbit.getState().updateMessage(rid, assistantMessageId, {
                phase: "done",
                content: parsed.content,
                citations: parsed.citations.map(liveCitationToUi),
              })
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

  return {
    send,
    stop,
    busyId,
    isBusy: busyId !== null,
    loadContent,
    branchFrom,
    activateBranch,
    regenerate: branchFrom,
    editAndBranch,
  }
}
