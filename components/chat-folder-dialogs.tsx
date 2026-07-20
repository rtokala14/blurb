"use client"

import * as React from "react"
import { FolderX, MessageSquareText } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  CHAT_FOLDER_COLORS,
  chatFolderColorClass,
  createChatFolder,
  deleteChatFolder,
  updateChatFolder,
  type ChatFolderColor,
} from "@/hooks/use-chat-folders"
import { useOrbit } from "@/lib/store"
import { cn } from "@/lib/utils"
import type { ChatFolder } from "@/lib/types"

/**
 * Create / rename+recolor dialog for chat folders. Pass folder=null to
 * create. onCreated fires with the new folder (used by "New folder…" in the
 * move-to menu to immediately file the session).
 */
export function ChatFolderDialog({
  open,
  onOpenChange,
  folder,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: ChatFolder | null
  onCreated?: (folder: ChatFolder) => void
}) {
  const [name, setName] = React.useState("")
  const [color, setColor] = React.useState<ChatFolderColor>("slate")
  const [saving, setSaving] = React.useState(false)

  const [prevOpen, setPrevOpen] = React.useState(open)
  const [prevFolder, setPrevFolder] = React.useState(folder)
  if (open !== prevOpen || folder !== prevFolder) {
    setPrevOpen(open)
    setPrevFolder(folder)
    if (open) {
      setName(folder?.name ?? "")
      setColor((folder?.color as ChatFolderColor) ?? "slate")
    }
  }

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      if (folder) {
        await updateChatFolder(folder, { name: trimmed, color })
      } else {
        const created = await createChatFolder(trimmed, color)
        if (created) onCreated?.(created)
      }
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{folder ? "Edit folder" : "New session folder"}</DialogTitle>
          <DialogDescription>
            {folder
              ? "Rename the folder or pick a different color."
              : "Group related chats — project, site, or topic."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <Input
            placeholder="Folder name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            autoFocus
          />
          <div className="flex items-center gap-2.5">
            {CHAT_FOLDER_COLORS.map((token) => (
              <button
                key={token}
                type="button"
                aria-label={`${token} color`}
                aria-pressed={color === token}
                className={cn(
                  "size-6 rounded-full transition-all",
                  chatFolderColorClass[token],
                  color === token
                    ? "ring-ring ring-offset-background scale-110 ring-2 ring-offset-2"
                    : "opacity-60 hover:scale-105 hover:opacity-100"
                )}
                onClick={() => setColor(token)}
              />
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : folder ? "Save" : "Create folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Delete dialog with the PoC's keep-or-delete-sessions choice. */
export function DeleteChatFolderDialog({
  open,
  onOpenChange,
  folder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: ChatFolder | null
}) {
  const sessions = useOrbit((s) => s.sessions)
  const [mode, setMode] = React.useState<"keep" | "delete">("keep")
  const [deleting, setDeleting] = React.useState(false)

  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setMode("keep")
  }

  if (!folder) return null
  const memberCount = sessions.filter((s) => s.chatFolderId === folder.id).length

  const confirm = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      const ok = await deleteChatFolder(folder, mode === "delete")
      if (ok) onOpenChange(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{folder.name}”?</DialogTitle>
          <DialogDescription>
            {memberCount === 0
              ? "This folder is empty — it will be removed."
              : `This folder holds ${memberCount} ${memberCount === 1 ? "chat" : "chats"}. Choose what happens to ${memberCount === 1 ? "it" : "them"}.`}
          </DialogDescription>
        </DialogHeader>
        {memberCount > 0 && (
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as typeof mode)}
            className="gap-2 py-1"
          >
            <Label
              htmlFor="cf-keep"
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                mode === "keep" && "border-primary/50 bg-primary/5"
              )}
            >
              <RadioGroupItem value="keep" id="cf-keep" className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <MessageSquareText className="size-3.5" /> Keep the chats
                </span>
                <span className="text-muted-foreground block text-xs font-normal">
                  They move back to your recent sessions.
                </span>
              </span>
            </Label>
            <Label
              htmlFor="cf-delete"
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                mode === "delete" && "border-destructive/50 bg-destructive/5"
              )}
            >
              <RadioGroupItem value="delete" id="cf-delete" className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <FolderX className="size-3.5" /> Delete them too
                </span>
                <span className="text-muted-foreground block text-xs font-normal">
                  {memberCount === 1 ? "The chat" : `All ${memberCount} chats`} in this
                  folder {memberCount === 1 ? "is" : "are"} deleted as well.
                </span>
              </span>
            </Label>
          </RadioGroup>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
