"use client"

import * as React from "react"

import { useChatSimulation } from "@/components/chat/use-chat-simulation"
import { useLiveChat } from "@/components/chat/use-live-chat"
import { useOrbit } from "@/lib/store"
import type { ChatMessage } from "@/lib/types"

export interface ChatController {
  send: (text: string) => void
  regenerate: (message: ChatMessage) => void
  editAndBranch: (message: ChatMessage, newText: string) => void
  stop: () => void
  isBusy: boolean
  busyId: string | null
  live: boolean
  loadContent?: (rid: string) => Promise<void>
  activateBranch?: (branchId: string) => Promise<void>
}

/**
 * Unified chat controller: routes to the Foundry-backed hook in live mode,
 * or the built-in simulation in demo mode. Both hooks are always mounted
 * (hooks can't be conditional) but only the active one is exercised.
 */
export function useChat(sessionId: string): ChatController {
  const live = useOrbit((s) => s.live === true)
  const sim = useChatSimulation(sessionId)
  const liveChat = useLiveChat(sessionId)

  return React.useMemo<ChatController>(() => {
    if (live) {
      return {
        send: liveChat.send,
        regenerate: liveChat.branchFrom,
        editAndBranch: liveChat.editAndBranch,
        stop: liveChat.stop,
        isBusy: liveChat.isBusy,
        busyId: liveChat.busyId,
        live: true,
        loadContent: liveChat.loadContent,
        activateBranch: liveChat.activateBranch,
      }
    }
    return {
      send: sim.send,
      regenerate: sim.regenerate,
      editAndBranch: sim.editAndBranch,
      stop: sim.stop,
      isBusy: sim.isBusy,
      busyId: sim.busyId,
      live: false,
    }
  }, [live, sim, liveChat])
}
