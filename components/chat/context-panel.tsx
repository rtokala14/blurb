"use client"

import * as React from "react"
import { Cloud, Folder, Search, Sparkles, X } from "lucide-react"

import { DocIcon } from "@/components/doc-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useOrbit } from "@/lib/store"
import type { ChatSession } from "@/lib/types"

/**
 * Scope selector: pick the folders/documents the assistant is allowed to
 * ground its answers in. Folder checkboxes tri-state over their contents.
 */
export function ContextPanel({
  session,
  onClose,
}: {
  session: ChatSession
  onClose: () => void
}) {
  const docs = useOrbit((s) => s.docs)
  const folders = useOrbit((s) => s.folders)
  const setSessionScope = useOrbit((s) => s.setSessionScope)
  const [query, setQuery] = React.useState("")

  const selected = new Set(session.scopeDocIds)
  const selectable = docs.filter((d) => d.status === "ready")

  const setSelected = (next: Set<string>) =>
    setSessionScope(session.id, Array.from(next))

  const toggleDoc = (docId: string) => {
    const next = new Set(selected)
    if (next.has(docId)) next.delete(docId)
    else next.add(docId)
    setSelected(next)
  }

  const tokenEstimate = docs
    .filter((d) => selected.has(d.id))
    .reduce((sum, d) => sum + d.pages * 620, 0)

  const rootFolders = folders.filter((f) => f.parentId === null)

  const renderFolder = (folderId: string, depth: number) => {
    const folder = folders.find((f) => f.id === folderId)
    if (!folder) return null
    const childFolders = folders.filter((f) => f.parentId === folderId)
    const contained = selectable.filter(
      (d) =>
        d.folderId === folderId &&
        (!query || d.name.toLowerCase().includes(query.toLowerCase()))
    )
    /* all selectable docs in this folder + descendants */
    const deepDocIds: string[] = [
      ...contained.map((d) => d.id),
      ...childFolders.flatMap((cf) =>
        selectable
          .filter((d) => d.folderId === cf.id)
          .map((d) => d.id)
      ),
    ]
    if (deepDocIds.length === 0 && childFolders.length === 0) return null
    if (query && deepDocIds.length === 0) return null

    const selectedCount = deepDocIds.filter((id) => selected.has(id)).length
    const folderState: boolean | "indeterminate" =
      deepDocIds.length > 0 && selectedCount === deepDocIds.length
        ? true
        : selectedCount > 0
          ? "indeterminate"
          : false

    const FolderIcon =
      folder.source === "sharepoint"
        ? Cloud
        : folder.source === "generated"
          ? Sparkles
          : Folder

    return (
      <div key={folder.id}>
        <label
          className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5"
          style={{ paddingLeft: depth * 14 + 8 }}
        >
          <Checkbox
            checked={folderState}
            onCheckedChange={(v) => {
              const next = new Set(selected)
              if (v === true) deepDocIds.forEach((id) => next.add(id))
              else deepDocIds.forEach((id) => next.delete(id))
              setSelected(next)
            }}
          />
          <FolderIcon
            className={
              folder.source === "sharepoint"
                ? "size-4 text-sky-600 dark:text-sky-400"
                : "text-muted-foreground size-4"
            }
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {folder.name}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {selectedCount}/{deepDocIds.length}
          </span>
        </label>
        {contained.map((doc) => (
          <label
            key={doc.id}
            className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5"
            style={{ paddingLeft: depth * 14 + 30 }}
          >
            <Checkbox
              checked={selected.has(doc.id)}
              onCheckedChange={() => toggleDoc(doc.id)}
            />
            <DocIcon type={doc.type} />
            <span className="min-w-0 flex-1 truncate text-sm">{doc.name}</span>
          </label>
        ))}
        {childFolders.map((cf) => renderFolder(cf.id, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <h3 className="text-sm font-semibold">Context scope</h3>
        <Badge variant="secondary" className="tabular-nums">
          {selected.size} selected
        </Badge>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Close context panel"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>

      <p className="text-muted-foreground border-b px-3 py-2 text-xs leading-relaxed">
        The assistant only reads what you select here. Citations always point
        back to these sources.
      </p>

      <div className="border-b p-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            placeholder="Find documents…"
            className="h-8 pl-8 text-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">{rootFolders.map((f) => renderFolder(f.id, 0))}</div>
      </ScrollArea>

      <div className="space-y-2 border-t p-3">
        <div className="text-muted-foreground flex justify-between text-xs">
          <span>Estimated context</span>
          <span className="tabular-nums">
            ≈ {tokenEstimate >= 1000 ? `${Math.round(tokenEstimate / 1000)}k` : tokenEstimate}{" "}
            tokens
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setSelected(new Set(selectable.map((d) => d.id)))}
          >
            Select all
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      </div>
    </div>
  )
}
