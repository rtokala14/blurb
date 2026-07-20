"use client"

import * as React from "react"
import { toast } from "sonner"

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
import {
  CHAT_FOLDER_COLORS,
  chatFolderColorClass,
  type ChatFolderColor,
} from "@/hooks/use-chat-folders"
import { liveApi } from "@/lib/live-api"
import { syncDeleteFolder, syncUpdateFolder } from "@/lib/live-sync"
import { useOrbit } from "@/lib/store"
import { cn } from "@/lib/utils"
import type { DocFolder } from "@/lib/types"

/** Reused palette — folder colors share the app's folder swatch tokens. */
export const FOLDER_COLORS = CHAT_FOLDER_COLORS
export const folderColorClass = chatFolderColorClass

/**
 * Create / rename+recolor dialog for library folders. Pass folder=null to
 * create at `parentId` (null = a root-level folder). Persisted server-side.
 */
export function DocFolderDialog({
  open,
  onOpenChange,
  folder,
  parentId = null,
  parentName,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: DocFolder | null
  parentId?: string | null
  parentName?: string
  onCreated?: (folder: DocFolder) => void
}) {
  const addFolder = useOrbit((s) => s.addFolder)
  const patchFolder = useOrbit((s) => s.patchFolder)
  const liveUserEmail = useOrbit((s) => s.liveUserEmail)

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
    if (folder) {
      // Rename / recolor. Color stays client-side (server has no folder color).
      patchFolder(folder.id, { name: trimmed, color })
      syncUpdateFolder(folder.id, { name: trimmed })
      onOpenChange(false)
      return
    }
    // Create. The server issues the real primary key, so create there first
    // and adopt the returned id.
    setSaving(true)
    try {
      const created = await liveApi.createFolder({
        name: trimmed,
        parentId: parentId ?? undefined,
        accessEmails: liveUserEmail ? [liveUserEmail] : undefined,
      })
      const mapped: DocFolder = {
        id: created.primaryKey,
        name: created.name,
        parentId: created.parentId ?? parentId,
        source: "upload",
        color,
        createdBy: created.createdBy || (liveUserEmail ?? undefined),
        accessEmails: created.accessEmails.length
          ? created.accessEmails
          : liveUserEmail
            ? [liveUserEmail]
            : undefined,
      }
      addFolder(mapped)
      onCreated?.(mapped)
      onOpenChange(false)
    } catch (error) {
      toast.error("Couldn't create the folder", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{folder ? "Edit folder" : "New folder"}</DialogTitle>
          <DialogDescription>
            {folder
              ? "Rename the folder or pick a different color."
              : parentName
                ? `Create a folder inside “${parentName}”.`
                : "Create a folder at the top level of your library."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <Input
            placeholder="Folder name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            autoFocus
          />
          <div className="flex items-center gap-2.5">
            {FOLDER_COLORS.map((token) => (
              <button
                key={token}
                type="button"
                aria-label={`${token} color`}
                aria-pressed={color === token}
                className={cn(
                  "size-6 rounded-full transition-all",
                  folderColorClass[token],
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!name.trim() || saving}>
            {folder ? "Save" : saving ? "Creating…" : "Create folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Delete confirmation. Nested folders and contained docs are surfaced. */
export function DeleteDocFolderDialog({
  open,
  onOpenChange,
  folder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: DocFolder | null
}) {
  const folders = useOrbit((s) => s.folders)
  const docs = useOrbit((s) => s.docs)
  const removeFolder = useOrbit((s) => s.removeFolder)

  const affected = React.useMemo(() => {
    if (!folder) return { folderIds: new Set<string>(), subCount: 0, docCount: 0 }
    const folderIds = new Set<string>([folder.id])
    let changed = true
    while (changed) {
      changed = false
      for (const f of folders) {
        if (f.parentId && folderIds.has(f.parentId) && !folderIds.has(f.id)) {
          folderIds.add(f.id)
          changed = true
        }
      }
    }
    const docCount = docs.filter((d) => d.folderId && folderIds.has(d.folderId)).length
    return { folderIds, subCount: folderIds.size - 1, docCount }
  }, [folder, folders, docs])

  if (!folder) return null

  const confirm = () => {
    // Delete every affected folder server-side (force clears nested mappings);
    // the store already unfiles contained docs to the library root.
    for (const id of affected.folderIds) syncDeleteFolder(id)
    removeFolder(folder.id)
    onOpenChange(false)
  }

  const parts: string[] = []
  if (affected.subCount > 0)
    parts.push(`${affected.subCount} nested ${affected.subCount === 1 ? "folder" : "folders"}`)
  if (affected.docCount > 0)
    parts.push(`${affected.docCount} ${affected.docCount === 1 ? "document" : "documents"}`)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{folder.name}”?</DialogTitle>
          <DialogDescription>
            {parts.length === 0
              ? "This folder is empty — it will be removed."
              : `This removes the folder along with ${parts.join(" and ")}. The documents aren't deleted — they move back to the library root.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm}>
            Delete folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
