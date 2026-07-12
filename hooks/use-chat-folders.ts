"use client"

import { toast } from "sonner"

import { liveApi } from "@/lib/live-api"
import { mapLiveChatFolder } from "@/lib/live-map"
import { useOrbit } from "@/lib/store"
import type { ChatFolder } from "@/lib/types"

/**
 * Chat-folder mutations: optimistic store updates backed by the
 * /api/orbit/chat-folders routes. All errors surface as toasts and roll
 * back where it matters.
 */

export const CHAT_FOLDER_COLORS = [
  "slate",
  "sky",
  "indigo",
  "teal",
  "emerald",
  "amber",
  "rose",
] as const

export type ChatFolderColor = (typeof CHAT_FOLDER_COLORS)[number]

/** Swatch + text tints per token, tuned for both themes. */
export const chatFolderColorClass: Record<ChatFolderColor, string> = {
  slate: "bg-slate-500 dark:bg-slate-400",
  sky: "bg-sky-500 dark:bg-sky-400",
  indigo: "bg-indigo-500 dark:bg-indigo-400",
  teal: "bg-teal-500 dark:bg-teal-400",
  emerald: "bg-emerald-500 dark:bg-emerald-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  rose: "bg-rose-500 dark:bg-rose-400",
}

export function folderSwatchClass(color: string | null | undefined): string {
  return chatFolderColorClass[(color as ChatFolderColor) ?? "slate"] ?? chatFolderColorClass.slate
}

export async function createChatFolder(
  name: string,
  color: ChatFolderColor
): Promise<ChatFolder | null> {
  try {
    const created = await liveApi.createChatFolder({ name, color })
    const mapped = mapLiveChatFolder(created)
    useOrbit.getState().addChatFolder(mapped)
    return mapped
  } catch (error) {
    toast.error("Couldn't create the folder", {
      description: error instanceof Error ? error.message : undefined,
    })
    return null
  }
}

export async function updateChatFolder(
  folder: ChatFolder,
  patch: Partial<{ name: string; color: string }>
): Promise<void> {
  const store = useOrbit.getState()
  store.patchChatFolder(folder.id, patch)
  try {
    await liveApi.updateChatFolder(folder.id, patch)
  } catch (error) {
    store.patchChatFolder(folder.id, { name: folder.name, color: folder.color })
    toast.error("Couldn't update the folder", {
      description: error instanceof Error ? error.message : undefined,
    })
  }
}

export async function deleteChatFolder(
  folder: ChatFolder,
  deleteSessions: boolean
): Promise<boolean> {
  try {
    await liveApi.deleteChatFolder(folder.id, deleteSessions)
    if (deleteSessions) {
      // drop member sessions locally — the server already soft-deleted them
      useOrbit.setState((s) => ({
        sessions: s.sessions.filter((x) => x.chatFolderId !== folder.id),
      }))
    }
    useOrbit.getState().removeChatFolder(folder.id)
    toast("Folder deleted", { description: folder.name })
    return true
  } catch (error) {
    toast.error("Couldn't delete the folder", {
      description: error instanceof Error ? error.message : undefined,
    })
    return false
  }
}

export async function moveSessionToFolder(
  sessionId: string,
  folderId: string | null
): Promise<void> {
  const store = useOrbit.getState()
  const previous = store.sessions.find((s) => s.id === sessionId)?.chatFolderId ?? null
  store.patchSession(sessionId, { chatFolderId: folderId })
  try {
    await liveApi.assignSessionFolder(sessionId, folderId)
  } catch (error) {
    store.patchSession(sessionId, { chatFolderId: previous })
    toast.error("Couldn't move the session", {
      description: error instanceof Error ? error.message : undefined,
    })
  }
}
