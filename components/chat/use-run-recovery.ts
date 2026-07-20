"use client"

import * as React from "react"

import { liveApi } from "@/lib/live-api"
import { useOrbit } from "@/lib/store"

/**
 * Recover an in-flight run after a refresh or dropped stream. When a live
 * session opens with runStatus "in_progress", poll /run until the status
 * settles to "idle" (completed) or "failed", then reload the message tree.
 *
 * Deliberately defensive: bounded attempts, backoff on errors, cancels on
 * session switch/unmount, and only ever runs when this client isn't itself
 * streaming (the stream path owns the run then). There is no trace status in
 * v3 — recovery is purely status polling + a content refetch.
 */
const POLL_MS = 5_000
const MAX_POLLS = 36 // ~3 minutes, matching the server's turn ceiling

export function useRunRecovery(
  sessionId: string | null,
  isBusy: boolean,
  reloadContent: ((rid: string) => Promise<void>) | undefined
) {
  const [recovering, setRecovering] = React.useState(false)

  React.useEffect(() => {
    if (!sessionId || isBusy) {
      setRecovering(false)
      return
    }
    const store = useOrbit.getState()
    const session = store.sessions.find((s) => s.id === sessionId)
    if (!session?.live || session.runStatus !== "in_progress") return

    let cancelled = false
    let polls = 0
    let errors = 0
    setRecovering(true)

    const finish = async (reload: boolean) => {
      if (cancelled) return
      setRecovering(false)
      if (reload && reloadContent) {
        await reloadContent(sessionId).catch(() => undefined)
      }
    }

    const tick = async () => {
      if (cancelled) return
      polls++
      try {
        const run = await liveApi.run(sessionId)
        if (cancelled) return
        errors = 0
        if (run.status === "idle") {
          useOrbit.getState().patchSession(sessionId, { runStatus: "idle" })
          await finish(true)
          return
        }
        if (run.status === "failed") {
          useOrbit.getState().patchSession(sessionId, { runStatus: "failed" })
          await finish(true)
          return
        }
      } catch {
        // transient — tolerate a few, then give up quietly
        errors++
        if (errors >= 4) {
          await finish(false)
          return
        }
      }
      if (polls >= MAX_POLLS) {
        await finish(false)
        return
      }
      timer = setTimeout(tick, POLL_MS)
    }

    let timer = setTimeout(tick, 1_000)
    return () => {
      cancelled = true
      clearTimeout(timer)
      setRecovering(false)
    }
  }, [sessionId, isBusy, reloadContent])

  return recovering
}
