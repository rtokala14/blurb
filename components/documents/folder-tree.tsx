"use client"

import * as React from "react"
import {
  ChevronRight,
  Cloud,
  FolderPlus,
  Library,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { folderSwatchClass } from "@/hooks/use-chat-folders"
import { cn } from "@/lib/utils"
import { useOrbit } from "@/lib/store"
import type { DocFolder } from "@/lib/types"

/** Actions a user folder exposes from its row menu (all optional/local). */
export type FolderActions = {
  /** open the create dialog under `parentId` (null = a root-level folder) */
  onNewSubfolder: (parentId: string | null) => void
  onEdit: (folder: DocFolder) => void
  onShare: (folder: DocFolder) => void
  onDelete: (folder: DocFolder) => void
}

/** Precomputed tree shape so nodes don't each scan the full folder/doc arrays. */
type FolderIndex = {
  /** parentId (or "\0" for roots) -> child folders */
  childrenByParent: Map<string, DocFolder[]>
  /** folderId -> direct document count */
  docCountByFolder: Map<string, number>
}

const ROOT_KEY = "\0"

const FolderNode = React.memo(function FolderNode({
  folder,
  depth,
  currentFolderId,
  onSelect,
  index,
  actions,
}: {
  folder: DocFolder
  depth: number
  currentFolderId: string | null
  onSelect: (id: string | null) => void
  index: FolderIndex
  actions?: FolderActions
}) {
  const children = index.childrenByParent.get(folder.id) ?? EMPTY_FOLDERS
  const count = index.docCountByFolder.get(folder.id) ?? 0
  const active = currentFolderId === folder.id
  const [open, setOpen] = React.useState(false)

  const isUpload = folder.source === "upload"
  const sharedCount = Math.max((folder.accessEmails?.length ?? 1) - 1, 0)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "group hover:bg-accent flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm",
          active && "bg-accent font-medium"
        )}
        style={{ paddingLeft: depth * 14 + 8 }}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(folder.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onSelect(folder.id)
          }
        }}
      >
        {children.length > 0 ? (
          <CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
            <button type="button"
              aria-label={open ? "Collapse folder" : "Expand folder"}
              className="hover:bg-muted-foreground/20 -ml-1 rounded p-0.5"
            >
              <ChevronRight
                className={cn(
                  "text-muted-foreground size-3.5 transition-transform",
                  open && "rotate-90"
                )}
              />
            </button>
          </CollapsibleTrigger>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {folder.source === "sharepoint" ? (
          <Cloud className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
        ) : folder.source === "generated" ? (
          <Sparkles className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
        ) : (
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              folderSwatchClass(folder.color)
            )}
          />
        )}
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        {isUpload && sharedCount > 0 && (
          <Users className="text-muted-foreground size-3 shrink-0" />
        )}
        {count > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {count}
          </span>
        )}
        {isUpload && actions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                aria-label={`Actions for ${folder.name}`}
                className="hover:bg-muted-foreground/20 text-muted-foreground -mr-1 rounded p-0.5 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="right"
              className="w-44"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem onClick={() => actions.onNewSubfolder(folder.id)}>
                <FolderPlus /> New subfolder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onEdit(folder)}>
                <Pencil /> Rename &amp; color
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onShare(folder)}>
                <Users /> Share
                {sharedCount > 0 && (
                  <span className="text-muted-foreground ml-auto text-xs">
                    {sharedCount}
                  </span>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => actions.onDelete(folder)}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {children.length > 0 && (
        <CollapsibleContent>
          {children.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              currentFolderId={currentFolderId}
              onSelect={onSelect}
              index={index}
              actions={actions}
            />
          ))}
        </CollapsibleContent>
      )}
    </Collapsible>
  )
})

const EMPTY_FOLDERS: DocFolder[] = []

export function FolderTree({
  currentFolderId,
  onSelect,
  actions,
}: {
  currentFolderId: string | null
  onSelect: (id: string | null) => void
  actions?: FolderActions
}) {
  const folders = useOrbit((s) => s.folders)
  const docs = useOrbit((s) => s.docs)

  // Build the tree shape once per folders/docs change instead of having every
  // node subscribe to (and re-filter) the full arrays. This turns an
  // O(nodes × docs) re-render on any doc change into O(nodes + docs).
  const index = React.useMemo<FolderIndex>(() => {
    const childrenByParent = new Map<string, DocFolder[]>()
    for (const f of folders) {
      const key = f.parentId ?? ROOT_KEY
      const list = childrenByParent.get(key)
      if (list) list.push(f)
      else childrenByParent.set(key, [f])
    }
    const docCountByFolder = new Map<string, number>()
    for (const d of docs) {
      if (!d.folderId) continue
      docCountByFolder.set(d.folderId, (docCountByFolder.get(d.folderId) ?? 0) + 1)
    }
    return { childrenByParent, docCountByFolder }
  }, [folders, docs])

  const roots = index.childrenByParent.get(ROOT_KEY) ?? EMPTY_FOLDERS
  const spCount = React.useMemo(
    () => docs.filter((d) => d.source === "sharepoint").length,
    [docs]
  )

  return (
    <div className="space-y-4">
      <div>
        <button
          type="button"
          className={cn(
            "hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
            currentFolderId === null && "bg-accent font-medium"
          )}
          onClick={() => onSelect(null)}
        >
          <Library className="text-muted-foreground size-4" />
          <span className="flex-1">All documents</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {docs.length}
          </span>
        </button>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between px-2">
          <p className="text-muted-foreground text-xs font-medium">Folders</p>
          {actions && (
            <button
              type="button"
              aria-label="New top-level folder"
              className="hover:bg-accent text-muted-foreground rounded p-0.5"
              onClick={() => actions.onNewSubfolder(null)}
            >
              <FolderPlus className="size-3.5" />
            </button>
          )}
        </div>
        {roots.flatMap((folder) =>
          folder.source !== "sharepoint"
            ? [
                <FolderNode
                  key={folder.id}
                  folder={folder}
                  depth={0}
                  currentFolderId={currentFolderId}
                  onSelect={onSelect}
                  index={index}
                  actions={actions}
                />,
              ]
            : []
        )}
      </div>
      {/* Only rendered when a SharePoint sync actually exists. */}
      {(spCount > 0 || roots.some((f) => f.source === "sharepoint")) && (
        <div>
          <div className="mb-1 flex items-center justify-between px-2">
            <p className="text-muted-foreground text-xs font-medium">
              SharePoint
            </p>
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
              {spCount} synced
            </Badge>
          </div>
          {roots.flatMap((folder) =>
            folder.source === "sharepoint"
              ? [
                  <FolderNode
                    key={folder.id}
                    folder={folder}
                    depth={0}
                    currentFolderId={currentFolderId}
                    onSelect={onSelect}
                    index={index}
                    actions={actions}
                  />,
                ]
              : []
          )}
        </div>
      )}
    </div>
  )
}
