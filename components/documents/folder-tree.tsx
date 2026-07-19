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
}: {
  folder: DocFolder
  depth: number
  currentFolderId: string | null
  onSelect: (id: string | null) => void
  index: FolderIndex
}) {
  const children = index.childrenByParent.get(folder.id) ?? EMPTY_FOLDERS
  const count = index.docCountByFolder.get(folder.id) ?? 0
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
              index={index}
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
}: {
  currentFolderId: string | null
  onSelect: (id: string | null) => void
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
              index={index}
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
              index={index}
            />
          ))}
      </div>
    </div>
  )
}
