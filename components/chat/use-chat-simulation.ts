"use client"

import * as React from "react"
import { toast } from "sonner"

import { simulateResponse, varyResponse, type SimulatedResponse } from "@/lib/simulated-responses"
import { uid, useOrbit } from "@/lib/store"
import type { Artifact, ChatMessage } from "@/lib/types"

const THINK_STEP_MS = 750
const STREAM_TICK_MS = 35
const TOKENS_PER_TICK = 2

/**
 * Drives the fully client-side chat placeholder: thinking steps appear one
 * by one, the answer streams token by token, and artifact generation is
 * kicked off when the prompt asks for a document/spreadsheet/deck.
 */
export function useChatSimulation(sessionId: string) {
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const timeouts = React.useRef<ReturnType<typeof setTimeout>[]>([])
  const intervals = React.useRef<ReturnType<typeof setInterval>[]>([])

  const clearAll = React.useCallback(() => {
    timeouts.current.forEach(clearTimeout)
    intervals.current.forEach(clearInterval)
    timeouts.current = []
    intervals.current = []
  }, [])

  React.useEffect(() => clearAll, [clearAll, sessionId])

  const schedule = (fn: () => void, ms: number) => {
    timeouts.current.push(setTimeout(fn, ms))
  }

  const runAssistant = React.useCallback(
    (parentId: string, response: SimulatedResponse) => {
      const {
        addMessage,
        addArtifact,
        updateArtifact,
        setOpenArtifact,
        pushActivity,
        sessions,
      } = useOrbit.getState()
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return

      const assistantId = uid("m")
      const message: ChatMessage = {
        id: assistantId,
        parentId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        phase: "thinking",
        thinking: [],
        citations: response.citations,
      }
      addMessage(sessionId, message)
      setBusyId(assistantId)

      /* 1. thinking steps appear one at a time */
      response.thinking.forEach((step, i) => {
        schedule(
          () =>
            useOrbit.getState().updateMessage(sessionId, assistantId, (m) => ({
              thinking: [...(m.thinking ?? []), step],
            })),
          400 + i * THINK_STEP_MS
        )
      })
      const thinkDoneAt = 400 + response.thinking.length * THINK_STEP_MS + 350

      /* 2. artifact generation starts as streaming begins */
      if (response.artifact) {
        const artifactId = uid("a")
        schedule(() => {
          const artifact: Artifact = {
            id: artifactId,
            kind: response.artifact!.kind,
            title: response.artifact!.title,
            status: "generating",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            sourceDocIds: session.scopeDocIds.slice(0, 4),
          }
          addArtifact(artifact)
          useOrbit.getState().updateMessage(sessionId, assistantId, {
            artifactIds: [artifactId],
          })
          setOpenArtifact(artifactId)
        }, thinkDoneAt)
        schedule(() => {
          updateArtifact(artifactId, {
            status: "ready",
            updatedAt: new Date().toISOString(),
            lastEditSummary: "Initial AI draft generated from the session scope.",
          })
          pushActivity({
            kind: "artifact",
            text: `AI created “${response.artifact!.title}”`,
            detail: `Grounded in ${session.scopeDocIds.length} scoped documents`,
          })
          toast.success("Draft ready in Studio", {
            description: response.artifact!.title,
          })
        }, thinkDoneAt + 9000)
      }

      /* 3. stream the answer token by token */
      schedule(() => {
        useOrbit.getState().updateMessage(sessionId, assistantId, {
          phase: "streaming",
        })
        const tokens = response.content.match(/\S+\s*/g) ?? [response.content]
        let cursor = 0
        const interval = setInterval(() => {
          cursor = Math.min(tokens.length, cursor + TOKENS_PER_TICK)
          const partial = tokens.slice(0, cursor).join("")
          useOrbit.getState().updateMessage(sessionId, assistantId, {
            content: partial,
          })
          if (cursor >= tokens.length) {
            clearInterval(interval)
            useOrbit.getState().updateMessage(sessionId, assistantId, {
              phase: "done",
            })
            setBusyId(null)
          }
        }, STREAM_TICK_MS)
        intervals.current.push(interval)
      }, thinkDoneAt)
    },
    [sessionId]
  )

  const send = React.useCallback(
    (text: string) => {
      const { sessions, docs, addMessage, renameSession, pushActivity } =
        useOrbit.getState()
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return

      const userId = uid("m")
      addMessage(sessionId, {
        id: userId,
        parentId: session.leafId,
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
        phase: "done",
        scopeLabel: `${session.scopeDocIds.length} ${session.scopeDocIds.length === 1 ? "document" : "documents"
          } in scope`,
      })
      if (session.title === "New session") {
        renameSession(
          sessionId,
          text.length > 42 ? `${text.slice(0, 42)}…` : text
        )
        pushActivity({
          kind: "chat",
          text: `New session “${text.slice(0, 42)}”`,
          detail: `${session.scopeDocIds.length} documents in scope`,
        })
      }

      const scopeDocs = docs.filter((d) => session.scopeDocIds.includes(d.id))
      runAssistant(userId, simulateResponse(text, scopeDocs))
    },
    [sessionId, runAssistant]
  )

  const regenerate = React.useCallback(
    (assistantMessage: ChatMessage) => {
      const { sessions, docs } = useOrbit.getState()
      const session = sessions.find((s) => s.id === sessionId)
      if (!session || !assistantMessage.parentId) return
      const userMessage = session.messages[assistantMessage.parentId]
      if (!userMessage) return
      const scopeDocs = docs.filter((d) => session.scopeDocIds.includes(d.id))
      runAssistant(
        userMessage.id,
        varyResponse(simulateResponse(userMessage.content, scopeDocs))
      )
    },
    [sessionId, runAssistant]
  )

  const editAndBranch = React.useCallback(
    (userMessage: ChatMessage, newText: string) => {
      const { sessions, docs, addMessage } = useOrbit.getState()
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return
      const newUserId = uid("m")
      addMessage(sessionId, {
        id: newUserId,
        parentId: userMessage.parentId,
        role: "user",
        content: newText,
        createdAt: new Date().toISOString(),
        phase: "done",
        scopeLabel: userMessage.scopeLabel,
        editedFrom: userMessage.id,
      })
      const scopeDocs = docs.filter((d) => session.scopeDocIds.includes(d.id))
      runAssistant(newUserId, simulateResponse(newText, scopeDocs))
      toast("Branched the conversation", {
        description: "The previous reply is still available via the branch switcher.",
      })
    },
    [sessionId, runAssistant]
  )

  const stop = React.useCallback(() => {
    clearAll()
    if (busyId) {
      useOrbit.getState().updateMessage(sessionId, busyId, (m) => ({
        phase: "done",
        content: m.content || "*(generation stopped)*",
      }))
    }
    setBusyId(null)
  }, [busyId, clearAll, sessionId])

  return React.useMemo(
    () => ({ send, regenerate, editAndBranch, stop, busyId, isBusy: busyId !== null }),
    [send, regenerate, editAndBranch, stop, busyId]
  )
}
