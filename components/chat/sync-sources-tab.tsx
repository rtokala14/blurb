"use client"

import * as React from "react"
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  CornerLeftUp,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  HardDrive,
  Monitor,
  Search,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { TimeAgo } from "@/components/time-ago"
import { liveApi, type SyncEntry } from "@/lib/live-api"
import { docTypeFromName } from "@/lib/live-map"
import { useOrbit } from "@/lib/store"
import { cn } from "@/lib/utils"
import type { Doc, SharePointSite } from "@/lib/types"

/**
 * PoC-parity "Synced" tab: sync-source cards that open into a per-source
 * file explorer (breadcrumb navigation, in-source search, folder tri-state
 * selection, indexed-file scoping) backed by /api/orbit/sync/sources/*.
 */

const parentPath = (path: string) => {
  const norm = path.replace(/\/+$/, "")
  const idx = norm.lastIndexOf("/")
  return idx === -1 ? "" : norm.slice(0, idx)
}

const pathSegments = (path: string) => path.split("/").filter(Boolean)

/** Synced files may not be in the store (only newest page loads) — adopt on scope. */
function adoptSyncedDoc(entry: SyncEntry, sourceName: string) {
  const store = useOrbit.getState()
  const id = entry.orbitObjectPk
  if (!id || store.docs.some((d) => d.id === id)) return
  store.addDoc({
    id,
    name: entry.name,
    type: docTypeFromName(entry.name),
    folderId: null,
    source: "sharepoint",
    status: "ready",
    sizeKB: 0,
    pages: 0,
    owner: sourceName,
    updatedAt: new Date().toISOString(),
    tags: [],
    summary: `Synced from ${sourceName} (${entry.path}).`,
    version: 1,
  } as Doc)
}

function EntryRow({
  entry,
  selected,
  folderState,
  onOpenFolder,
  onToggleFile,
  onToggleFolder,
  onPreview,
  showFullPath,
}: {
  entry: SyncEntry
  selected: boolean
  folderState?: "none" | "some" | "all"
  onOpenFolder: (path: string) => void
  onToggleFile: (entry: SyncEntry) => void
  onToggleFolder: (entry: SyncEntry, select: boolean) => void
  onPreview: (entry: SyncEntry) => void
  showFullPath?: boolean
}) {
  if (entry.isFolder) {
    const count = entry.folderCount + entry.fileCount
    const state = folderState ?? "none"
    return (
      <div className="group hover:bg-accent/40 flex w-full items-center gap-2 rounded-md px-2 py-1.5">
        <Checkbox
          checked={state === "all" ? true : state === "some" ? "indeterminate" : false}
          onCheckedChange={() => onToggleFolder(entry, state !== "all")}
          aria-label={state === "all" ? "Deselect folder" : "Select folder for AI"}
        />
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          onClick={() => onOpenFolder(entry.path)}
        >
          <Folder className="size-4 shrink-0 fill-amber-400/20 text-amber-500/80" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {entry.name}
          </span>
          {showFullPath && (
            <span className="text-muted-foreground/60 hidden max-w-[40%] min-w-0 truncate text-[10px] sm:block">
              {parentPath(entry.path) || "/"}
            </span>
          )}
          <span className="text-muted-foreground/60 shrink-0 text-[10px] tabular-nums">
            {count} item{count === 1 ? "" : "s"}
          </span>
          <ChevronRight className="text-muted-foreground/40 size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    )
  }

  const indexed = Boolean(entry.orbitObjectPk)
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5",
        selected ? "bg-primary/10" : "hover:bg-accent/40",
        !indexed && "opacity-60"
      )}
    >
      <Checkbox
        checked={selected}
        disabled={!indexed}
        onCheckedChange={() => onToggleFile(entry)}
        aria-label={selected ? "Deselect" : "Select for AI"}
      />
      <FileText
        className={cn(
          "size-3.5 shrink-0",
          selected ? "text-primary/70" : "text-muted-foreground/60"
        )}
      />
      <button
        type="button"
        className={cn(
          "min-w-0 flex-1 cursor-pointer truncate text-left text-sm",
          selected && "font-medium"
        )}
        title={entry.path}
        disabled={!indexed}
        onClick={() => indexed && onToggleFile(entry)}
      >
        {entry.name}
      </button>
      {showFullPath && (
        <span className="text-muted-foreground/60 hidden max-w-[35%] min-w-0 truncate text-[10px] sm:block">
          {parentPath(entry.path) || "/"}
        </span>
      )}
      {indexed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Preview ${entry.name}`}
              className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => onPreview(entry)}
            >
              <Eye className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Preview</TooltipContent>
        </Tooltip>
      )}
      {indexed ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 group-hover:hidden dark:text-emerald-400">
          <CheckCircle2 className="size-2.5" /> Indexed
        </span>
      ) : (
        <span className="bg-muted text-muted-foreground/60 inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium group-hover:hidden">
          Not indexed
        </span>
      )}
    </div>
  )
}

function SourceExplorer({
  site,
  selected,
  onToggleDocs,
  onBack,
  onPreviewDoc,
}: {
  site: SharePointSite
  selected: Set<string>
  /** add/remove doc pks from the session scope */
  onToggleDocs: (add: string[], remove: string[]) => void
  onBack: () => void
  onPreviewDoc: (doc: Doc) => void
}) {
  const [path, setPath] = React.useState("")
  const [searchInput, setSearchInput] = React.useState("")
  const [entries, setEntries] = React.useState<SyncEntry[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [folderDocs, setFolderDocs] = React.useState<Record<string, string[]>>({})
  const [pendingFolder, setPendingFolder] = React.useState<string | null>(null)
  const requestSeq = React.useRef(0)

  const query = searchInput.trim()
  const isSearching = query.length > 0

  /* browse or search, debounced for search */
  React.useEffect(() => {
    const seq = ++requestSeq.current
    setLoading(true)
    const run = async () => {
      try {
        const result = isSearching
          ? await liveApi.syncSearch(site.id, query)
          : await liveApi.syncBrowse(site.id, path)
        if (seq !== requestSeq.current) return
        setEntries(result.entries)
        setTotal(result.total)
      } catch {
        if (seq === requestSeq.current) {
          setEntries([])
          setTotal(0)
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false)
      }
    }
    const timer = setTimeout(run, isSearching ? 300 : 0)
    return () => clearTimeout(timer)
  }, [site.id, path, query, isSearching])

  /* lazily load descendant doc pks for visible folders (tri-state boxes) */
  React.useEffect(() => {
    const missing = entries
      .filter((e) => e.isFolder && !(e.path in folderDocs))
      .map((e) => e.path)
    if (missing.length === 0) return
    let cancelled = false
    void (async () => {
      const loaded: Record<string, string[]> = {}
      for (const p of missing) {
        try {
          loaded[p] = (await liveApi.syncFolderDocs(site.id, p)).docPks
        } catch {
          loaded[p] = []
        }
      }
      if (!cancelled) setFolderDocs((prev) => ({ ...prev, ...loaded }))
    })()
    return () => {
      cancelled = true
    }
  }, [entries, folderDocs, site.id])

  const folderState = (folderPath: string): "none" | "some" | "all" => {
    const pks = folderDocs[folderPath]
    if (!pks || pks.length === 0) return "none"
    const count = pks.filter((pk) => selected.has(pk)).length
    if (count === 0) return "none"
    return count === pks.length ? "all" : "some"
  }

  const handleToggleFile = (entry: SyncEntry) => {
    const pk = entry.orbitObjectPk
    if (!pk) return
    adoptSyncedDoc(entry, site.name)
    if (selected.has(pk)) onToggleDocs([], [pk])
    else onToggleDocs([pk], [])
  }

  const handleToggleFolder = async (entry: SyncEntry, select: boolean) => {
    let pks = folderDocs[entry.path]
    if (!pks) {
      setPendingFolder(entry.path)
      try {
        pks = (await liveApi.syncFolderDocs(site.id, entry.path)).docPks
        setFolderDocs((prev) => ({ ...prev, [entry.path]: pks! }))
      } catch {
        pks = []
      } finally {
        setPendingFolder(null)
      }
    }
    if (pks.length === 0) return
    if (select) onToggleDocs(pks, [])
    else onToggleDocs([], pks)
  }

  const handlePreview = (entry: SyncEntry) => {
    adoptSyncedDoc(entry, site.name)
    const doc = useOrbit.getState().docs.find((d) => d.id === entry.orbitObjectPk)
    if (doc) onPreviewDoc(doc)
  }

  const segments = pathSegments(path)

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="space-y-2 px-1 pt-1 pb-2">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            aria-label="Back to sources"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <HardDrive className="text-primary/60 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {site.name}
          </span>
          {site.url && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground size-7 shrink-0"
              aria-label="Open in SharePoint"
              onClick={() => window.open(site.url, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="size-3.5" />
            </Button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            placeholder="Search files and folders…"
            className="h-8 pr-8 pl-8 text-sm"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              aria-label="Clear search"
              onClick={() => setSearchInput("")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Breadcrumb / up bar */}
        {!isSearching && (
          <div className="flex items-center gap-1 overflow-x-auto">
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6 shrink-0 disabled:opacity-30"
              aria-label="Up one level"
              disabled={path === ""}
              onClick={() => setPath(parentPath(path))}
            >
              <CornerLeftUp className="size-3.5" />
            </Button>
            <button
              type="button"
              onClick={() => setPath("")}
              className={cn(
                "hover:bg-accent shrink-0 rounded px-1.5 py-0.5 text-xs",
                path === "" ? "text-foreground font-semibold" : "text-muted-foreground"
              )}
            >
              {site.name}
            </button>
            {segments.map((seg, i) => {
              const target = segments.slice(0, i + 1).join("/")
              return (
                <span key={target} className="flex shrink-0 items-center gap-1">
                  <ChevronRight className="text-muted-foreground/40 size-3" />
                  <button
                    type="button"
                    onClick={() => setPath(target)}
                    className={cn(
                      "hover:bg-accent rounded px-1.5 py-0.5 text-xs",
                      i === segments.length - 1
                        ? "text-foreground font-semibold"
                        : "text-muted-foreground"
                    )}
                  >
                    {seg}
                  </button>
                </span>
              )
            })}
          </div>
        )}
        {isSearching && !loading && (
          <p className="text-muted-foreground px-1 text-[11px]">
            {total} result{total === 1 ? "" : "s"} for “{query}”
          </p>
        )}
      </div>

      {/* Listing */}
      {loading ? (
        <p className="text-muted-foreground flex items-center gap-2 px-3 py-6 text-xs">
          <Spinner className="size-3.5" /> Loading…
        </p>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground/70 px-3 py-8 text-center text-xs italic">
          {isSearching ? "No matching files or folders" : "This folder is empty"}
        </p>
      ) : (
        <div className="space-y-0.5 px-1">
          {entries.map((entry) => (
            <EntryRow
              key={entry.path}
              entry={entry}
              selected={Boolean(entry.orbitObjectPk && selected.has(entry.orbitObjectPk))}
              folderState={
                entry.isFolder
                  ? pendingFolder === entry.path
                    ? "some"
                    : folderState(entry.path)
                  : undefined
              }
              onOpenFolder={(p) => {
                setSearchInput("")
                setPath(p)
              }}
              onToggleFile={handleToggleFile}
              onToggleFolder={handleToggleFolder}
              onPreview={handlePreview}
              showFullPath={isSearching}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function SyncSourcesTab({
  selected,
  onToggleDocs,
  onPreviewDoc,
}: {
  selected: Set<string>
  onToggleDocs: (add: string[], remove: string[]) => void
  onPreviewDoc: (doc: Doc) => void
}) {
  const sites = useOrbit((s) => s.sites)
  const [activeSiteId, setActiveSiteId] = React.useState<string | null>(null)
  const activeSite = sites.find((s) => s.id === activeSiteId) ?? null

  if (activeSite) {
    return (
      <SourceExplorer
        site={activeSite}
        selected={selected}
        onToggleDocs={onToggleDocs}
        onBack={() => setActiveSiteId(null)}
        onPreviewDoc={onPreviewDoc}
      />
    )
  }

  if (sites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <div className="border-border/60 bg-muted/40 flex size-12 items-center justify-center rounded-2xl border">
          <Monitor className="text-muted-foreground/40 size-5" />
        </div>
        <div>
          <p className="text-sm font-medium">No synced sources</p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            Install Orbit Sync on your desktop and complete a sync to see files
            here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 px-1 pb-4">
      <div className="flex items-center gap-2 px-1 pt-0.5 pb-1">
        <span className="text-muted-foreground/70 text-[10px] font-semibold tracking-wide uppercase">
          Sync sources
        </span>
        <div className="bg-border/50 h-px flex-1" />
        <span className="text-muted-foreground/60 text-[10px] tabular-nums">
          {sites.length}
        </span>
      </div>
      {sites.map((site) => (
        <button
          key={site.id}
          type="button"
          onClick={() => setActiveSiteId(site.id)}
          className="group border-border/50 bg-background/40 hover:border-border hover:bg-accent/20 flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors"
        >
          <HardDrive className="text-primary/60 mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{site.name}</p>
            <div className="text-muted-foreground/70 mt-1 flex items-center gap-2 text-[10px]">
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-emerald-500" /> Synced
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-2.5" />
                <TimeAgo iso={site.lastSyncedAt} />
              </span>
              {site.attentionCount > 0 && (
                <span>· {site.attentionCount} conflicts</span>
              )}
            </div>
          </div>
          <ChevronRight className="text-muted-foreground/40 mt-0.5 size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
      ))}
    </div>
  )
}
