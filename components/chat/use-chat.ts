"use client"

import { useLiveChat } from "@/components/chat/use-live-chat"
import type { ChatMessage } from "@/lib/types"

export interface ChatController {
  send: (text: string, opts?: { docSkillId?: string }) => void
  regenerate: (message: ChatMessage) => void
  editAndBranch: (message: ChatMessage, newText: string) => void
  stop: () => void
  isBusy: boolean
  busyId: string | null
  live: boolean
  loadContent?: (rid: string) => Promise<void>
}

/**
 * Chat controller — always Foundry-backed. (The `live` flag is retained on
 * the returned shape for call sites that still read it; it is always true.)
 */
export function useChat(sessionId: string): ChatController {
  const liveChat = useLiveChat(sessionId)
  return {
    send: liveChat.send,
    regenerate: liveChat.regenerate,
    editAndBranch: liveChat.editAndBranch,
    stop: liveChat.stop,
    isBusy: liveChat.isBusy,
    busyId: liveChat.busyId,
    live: true,
    loadContent: liveChat.loadContent,
  }
}
