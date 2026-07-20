"use client"

import * as React from "react"
import {
  ChevronRight,
  Cloud,
  Eye,
  Folder,
  PanelRightClose,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
} from "lucide-react"

import { DocIcon } from "@/components/doc-icon"
import { UploadDialog } from "@/components/documents/upload-dialog"
import { SyncSourcesTab } from "@/components/chat/sync-sources-tab"
import { adoptSearchResult, useLiveDocSearch } from "@/hooks/use-live-doc-search"
import { PdfViewerDialog } from "@/components/pdf-viewer-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { TimeAgo } from "@/components/time-ago"
import { useOrbit } from "@/lib/store"
import { useSharePointSync } from "@/lib/use-sharepoint-sync"
import type { ChatSession, Doc, DocFolder } from "@/lib/types"

/** Every selectable doc inside a folder or any of its descendants. */
function collectDescendantDocIds(
  folderId: string,
  folders: DocFolder[],
  selectable: Doc[]
): string[] {
  const ids = selectable.flatMap((d) => (d.folderId === folderId ? [d.id] : []))
  for (const child of folders.filter((f) => f.parentId === folderId)) {
    ids.push(...collectDescendantDocIds(child.id, folders, selectable))
  }
  return ids
}

/** A single document row in the tree. */
function DocRow({
  doc,
  depth,
  adopt = false,
  selected,
  onToggle,
  onPreview,
}: {
  doc: Doc
  depth: number
  /** server-search hit: pull it into the store before scoping it */
  adopt?: boolean
  selected: Set<string>
  onToggle: (doc: Doc, adopt: boolean) => void
  onPreview: (doc: Doc) => void
}) {
  const ready = doc.status === "ready"
  const toggle = () => onToggle(doc, adopt)
  return (
    <div
      className="hover:bg-accent group flex items-center gap-1.5 rounded-md px-1.5 py-1.5"
      style={{ paddingLeft: depth * 14 + 26 }}
    >
      <Checkbox
        checked={selected.has(doc.id)}
        disabled={!ready}
        onCheckedChange={toggle}
      />
      <DocIcon type={doc.type} />
      <button type="button"
        className={cn(
          "min-w-0 flex-1 cursor-pointer truncate text-left text-sm",
          !ready && "text-muted-foreground"
        )}
        disabled={!ready}
        title={doc.name}
        onClick={toggle}
      >
        {doc.name}
      </button>
      {!ready ? (
        <Badge variant="outline" className="h-4.5 gap-1 px-1 text-[9px] capitalize">
          <Spinner className="size-2.5" /> {doc.status}
        </Badge>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Preview ${doc.name}`}
              className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
              onClick={() => onPreview(doc)}
            >
              <Eye className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Preview</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

/** A folder node in the tree with tri-state selection over its descendants. */
function FolderNode({
  folder,
  depth,
  folders,
  docs,
  selected,
  matches,
  descendantDocIds,
  onSelectedChange,
  onToggleDoc,
  onPreview,
  query,
}: {
  folder: DocFolder
  depth: number
  folders: DocFolder[]
  docs: Doc[]
  selected: Set<string>
  matches: (doc: Doc) => boolean
  descendantDocIds: (folderId: string) => string[]
  onSelectedChange: (next: Set<string>) => void
  onToggleDoc: (doc: Doc, adopt: boolean) => void
  onPreview: (doc: Doc) => void
  query: string
}) {
  const [open, setOpen] = React.useState(false)
  const childFolders = folders.filter((f) => f.parentId === folder.id)
  const contained = docs.filter((d) => d.folderId === folder.id && matches(d))
  const deepIds = descendantDocIds(folder.id)
  if (query && contained.length === 0 && deepIds.every((id) => !matches(docs.find((d) => d.id === id)!)))
    return null

  const selectedCount = deepIds.filter((id) => selected.has(id)).length
  const state: boolean | "indeterminate" =
    deepIds.length > 0 && selectedCount === deepIds.length
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
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className="hover:bg-accent group flex items-center gap-1.5 rounded-md px-1.5 py-1.5"
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        <CollapsibleTrigger asChild>
          <button type="button"
            aria-label={open ? "Collapse folder" : "Expand folder"}
            className="hover:bg-muted-foreground/20 rounded p-0.5"
          >
            <ChevronRight
              className={cn(
                "text-muted-foreground size-3.5 transition-transform",
                open && "rotate-90"
              )}
            />
          </button>
        </CollapsibleTrigger>
        <Checkbox
          checked={state}
          disabled={deepIds.length === 0}
          onCheckedChange={(v) => {
            const next = new Set(selected)
            if (v === true) deepIds.forEach((id) => next.add(id))
            else deepIds.forEach((id) => next.delete(id))
            onSelectedChange(next)
          }}
        />
        <FolderIcon
          className={cn(
            "size-4 shrink-0",
            folder.source === "sharepoint"
              ? "text-sky-600 dark:text-sky-400"
              : folder.source === "generated"
                ? "text-chart-1"
                : "text-muted-foreground"
          )}
        />
        <button type="button"
          className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium"
          onClick={() => setOpen((v) => !v)}
        >
          {folder.name}
        </button>
        {deepIds.length > 0 && (
          <span className="text-muted-foreground text-[10px] tabular-nums">
            {selectedCount}/{deepIds.length}
          </span>
        )}
      </div>
      <CollapsibleContent>
        {contained.map((doc) => (
          <DocRow
            key={doc.id}
            doc={doc}
            depth={depth + 1}
            selected={selected}
            onToggle={onToggleDoc}
            onPreview={onPreview}
          />
        ))}
        {childFolders.map((child) => (
          <FolderNode
            key={child.id}
            folder={child}
            depth={depth + 1}
            folders={folders}
            docs={docs}
            selected={selected}
            matches={matches}
            descendantDocIds={descendantDocIds}
            onSelectedChange={onSelectedChange}
            onToggleDoc={onToggleDoc}
            onPreview={onPreview}
            query={query}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Right-side documents panel for the chat workspace: tree navigation with
 * tri-state selection (the session's grounding scope), inline preview,
 * uploads, and a tab for SharePoint-synced folders.
 */
export function DocumentsPanel({
  session,
  onClose,
}: {
  session: ChatSession
  onClose: () => void
}) {
  const docs = useOrbit((s) => s.docs)
  const folders = useOrbit((s) => s.folders)
  const sites = useOrbit((s) => s.sites)
  const live = useOrbit((s) => s.live === true)
  const setSessionScope = useOrbit((s) => s.setSessionScope)
  const syncSite = useSharePointSync()

  const [tab, setTab] = React.useState<"library" | "synced">("library")
  const [query, setQuery] = React.useState("")
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [previewDoc, setPreviewDoc] = React.useState<Doc | null>(null)

  const selected = new Set(session.scopeDocIds)
  const selectable = docs.filter((d) => d.status === "ready")
  const setSelected = (next: Set<string>) =>
    setSessionScope(session.id, Array.from(next))

  /** every selectable doc inside a folder or any of its descendants */
  const descendantDocIds = React.useMemo(
    () => (folderId: string): string[] =>
      collectDescendantDocIds(folderId, folders, selectable),
    [folders, selectable]
  )

  const matches = (doc: Doc) =>
    !query ||
    doc.name.toLowerCase().includes(query.toLowerCase()) ||
    doc.tags.some((t) => t.includes(query.toLowerCase()))

  // Live mode: also search the whole corpus server-side — the store holds
  // only the newest page of ~19k docs.
  const { results: serverHits, searching } = useLiveDocSearch(query)

  const toggleDoc = React.useCallback(
    (doc: Doc, adopt: boolean) => {
      if (adopt) adoptSearchResult(doc)
      const next = new Set(session.scopeDocIds)
      if (next.has(doc.id)) next.delete(doc.id)
      else next.add(doc.id)
      setSessionScope(session.id, Array.from(next))
    },
    [session.scopeDocIds, session.id, setSessionScope]
  )

  const libraryRoots = folders.filter(
    (f) => f.parentId === null && f.source !== "sharepoint"
  )
  const syncedRoots = folders.filter(
    (f) => f.parentId === null && f.source === "sharepoint"
  )

  return (
    <div className="bg-background flex h-full flex-col border-l">
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b px-2.5 py-2">
        <h3 className="pl-1 text-sm font-semibold">Documents</h3>
        <Badge variant="secondary" className="tabular-nums">
          {selected.size}
        </Badge>
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Upload documents or folders"
                onClick={() => setUploadOpen(true)}
              >
                <Upload />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Upload docs or folders</TooltipContent>
          </Tooltip>
          {/* the mobile sheet supplies its own close button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="max-md:hidden"
                aria-label="Collapse documents panel"
                onClick={onClose}
              >
                <PanelRightClose />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Collapse panel</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Tabs + search */}
      <div className="space-y-2 border-b p-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="synced" className="gap-1">
              <Cloud className="size-3" /> Synced
            </TabsTrigger>
          </TabsList>
        </Tabs>
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

      {/* Tree */}
      <div className="thin-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="p-1.5">
          {tab === "library" ? (
            <>
              {libraryRoots.map((folder) => (
                <FolderNode
                  key={folder.id}
                  folder={folder}
                  depth={0}
                  folders={folders}
                  docs={docs}
                  selected={selected}
                  matches={matches}
                  descendantDocIds={descendantDocIds}
                  onSelectedChange={setSelected}
                  onToggleDoc={toggleDoc}
                  onPreview={setPreviewDoc}
                  query={query}
                />
              ))}
              {/* uploads that aren't filed in any folder */}
              {docs.flatMap((doc) =>
                doc.folderId === null &&
                doc.source !== "sharepoint" &&
                matches(doc)
                  ? [
                      <DocRow
                        key={doc.id}
                        doc={doc}
                        depth={0}
                        selected={selected}
                        onToggle={toggleDoc}
                        onPreview={setPreviewDoc}
                      />,
                    ]
                  : []
              )}
              {/* corpus-wide matches from Foundry beyond the loaded page */}
              {searching && (
                <p className="text-muted-foreground flex items-center gap-1.5 px-2 py-1.5 text-xs">
                  <Spinner className="size-3" /> Searching all documents…
                </p>
              )}
              {serverHits.length > 0 && (
                <>
                  <p className="text-muted-foreground px-2 pt-2 pb-1 text-[10px] font-medium tracking-wide uppercase">
                    From your full library
                  </p>
                  {serverHits.map((doc) => (
                    <DocRow
                      key={doc.id}
                      doc={doc}
                      depth={0}
                      adopt
                      selected={selected}
                      onToggle={toggleDoc}
                      onPreview={setPreviewDoc}
                    />
                  ))}
                </>
              )}
            </>
          ) : live ? (
            /* Live mode: PoC-style explorer over the real sync-item tree —
               deep folder navigation, in-source search, folder tri-state. */
            <SyncSourcesTab
              selected={selected}
              onToggleDocs={(add, remove) => {
                const next = new Set(selected)
                add.forEach((id) => next.add(id))
                remove.forEach((id) => next.delete(id))
                setSelected(next)
              }}
              onPreviewDoc={setPreviewDoc}
            />
          ) : (
            <>
              {sites.map((site) => {
                const folder = folders.find((f) => f.id === site.mappedFolderId)
                return (
                  <div key={site.id} className="mb-2">
                    <div className="bg-muted/50 mb-1 flex items-center gap-2 rounded-md border px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{site.name}</p>
                        <p className="text-muted-foreground text-[10px]">
                          {site.state === "syncing"
                            ? "Syncing…"
                            : <>Synced <TimeAgo iso={site.lastSyncedAt} /></>}
                          {site.attentionCount > 0 &&
                            ` · ${site.attentionCount} conflicts`}
                        </p>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-6"
                            aria-label={`Sync ${site.name}`}
                            disabled={site.state === "syncing"}
                            onClick={() => syncSite(site.id)}
                          >
                            {site.state === "syncing" ? (
                              <Spinner className="size-3" />
                            ) : (
                              <RefreshCw className="size-3" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">Sync now</TooltipContent>
                      </Tooltip>
                    </div>
                    {folder && (
                      <FolderNode
                        folder={folder}
                        depth={0}
                        folders={folders}
                        docs={docs}
                        selected={selected}
                        matches={matches}
                        descendantDocIds={descendantDocIds}
                        onSelectedChange={setSelected}
                        onToggleDoc={toggleDoc}
                        onPreview={setPreviewDoc}
                        query={query}
                      />
                    )}
                  </div>
                )
              })}
              {syncedRoots.length === 0 && (
                <p className="text-muted-foreground p-3 text-xs">
                  No synced folders yet — connect a SharePoint site from
                  Connections.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="space-y-2 border-t p-2.5">
        <div className="text-muted-foreground text-xs">
          {selected.size} in scope · answers cite these sources
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 text-xs"
            onClick={() => setSelected(new Set(selectable.map((d) => d.id)))}
          >
            Select all
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 text-xs"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <PdfViewerDialog
        doc={previewDoc}
        open={previewDoc !== null}
        onOpenChange={(open) => !open && setPreviewDoc(null)}
      />
    </div>
  )
}
