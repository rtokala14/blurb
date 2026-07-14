"use client"

import * as React from "react"
import {
  ChevronRight,
  Cloud,
  Folder,
  FolderOpen,
  Library,
  Sparkles,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { useOrbit } from "@/lib/store"
import type { DocFolder } from "@/lib/types"

function FolderNode({
  folder,
  depth,
  currentFolderId,
  onSelect,
}: {
  folder: DocFolder
  depth: number
  currentFolderId: string | null
  onSelect: (id: string | null) => void
}) {
  const folders = useOrbit((s) => s.folders)
  const docs = useOrbit((s) => s.docs)
  const children = folders.filter((f) => f.parentId === folder.id)
  const count = docs.filter((d) => d.folderId === folder.id).length
  const active = currentFolderId === folder.id
  const [open, setOpen] = React.useState(false)

  const Icon =
    folder.source === "sharepoint" ? Cloud : folder.source === "generated" ? Sparkles : active ? FolderOpen : Folder

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "group hover:bg-accent flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm",
          active && "bg-accent font-medium"
        )}
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={() => onSelect(folder.id)}
      >
        {children.length > 0 ? (
          <CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
            <button
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
        <Icon
          className={cn(
            "size-4 shrink-0",
            folder.source === "sharepoint"
              ? "text-sky-600 dark:text-sky-400"
              : folder.source === "generated"
                ? "text-violet-600 dark:text-violet-400"
                : "text-muted-foreground"
          )}
        />
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        {count > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {count}
          </span>
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
            />
          ))}
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

export function FolderTree({
  currentFolderId,
  onSelect,
}: {
  currentFolderId: string | null
  onSelect: (id: string | null) => void
}) {
  const folders = useOrbit((s) => s.folders)
  const docs = useOrbit((s) => s.docs)
  const roots = folders.filter((f) => f.parentId === null)
  const spCount = docs.filter((d) => d.source === "sharepoint").length

  return (
    <div className="space-y-4">
      <div>
        <div
          className={cn(
            "hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
            currentFolderId === null && "bg-accent font-medium"
          )}
          onClick={() => onSelect(null)}
        >
          <Library className="text-muted-foreground size-4" />
          <span className="flex-1">All documents</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {docs.length}
          </span>
        </div>
      </div>
      <div>
        <p className="text-muted-foreground mb-1 px-2 text-xs font-medium">
          Folders
        </p>
        {roots
          .filter((f) => f.source !== "sharepoint")
          .map((folder) => (
            <FolderNode
              key={folder.id}
              folder={folder}
              depth={0}
              currentFolderId={currentFolderId}
              onSelect={onSelect}
            />
          ))}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between px-2">
          <p className="text-muted-foreground text-xs font-medium">SharePoint</p>
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            {spCount} synced
          </Badge>
        </div>
        {roots
          .filter((f) => f.source === "sharepoint")
          .map((folder) => (
            <FolderNode
              key={folder.id}
              folder={folder}
              depth={0}
              currentFolderId={currentFolderId}
              onSelect={onSelect}
            />
          ))}
      </div>
    </div>
  )
}
