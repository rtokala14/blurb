"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowUpDown,
  ChevronRight,
  Cloud,
  Folder,
  FolderInput,
  FolderPlus,
  FolderTree as FolderTreeIcon,
  LayoutGrid,
  Link2,
  List,
  MessageSquarePlus,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { DocIcon } from "@/components/doc-icon"
import { docTypeLabel } from "@/components/doc-icon-config"
import { DocPreviewSheet } from "@/components/documents/doc-preview-sheet"
import {
  DeleteDocFolderDialog,
  DocFolderDialog,
} from "@/components/documents/folder-dialogs"
import { ShareDialog } from "@/components/share-dialog"
import { adoptSearchResult, useLiveDocSearch } from "@/hooks/use-live-doc-search"
import { loadMoreLiveDocs } from "@/components/live-hydrate"
import { Checkbox } from "@/components/ui/checkbox"
import { FolderTree, type FolderActions } from "@/components/documents/folder-tree"
import { UploadDialog } from "@/components/documents/upload-dialog"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import { folderSwatchClass } from "@/hooks/use-chat-folders"
import { cn } from "@/lib/utils"
import { formatSize } from "@/lib/format"
import { TimeAgo } from "@/components/time-ago"
import { syncMoveDoc, syncUpdateFolder } from "@/lib/live-sync"
import { useOrbit } from "@/lib/store"
import type { Doc, DocFolder } from "@/lib/types"

type SortKey = "updated" | "name" | "size"

function StatusCell({ doc }: { doc: Doc }) {
  if (doc.status === "ready") return <Badge variant="secondary">Ready</Badge>
  if (doc.status === "error") return <Badge variant="destructive">Needs attention</Badge>
  if (doc.status === "syncing")
    return (
      <Badge variant="outline" className="gap-1">
        <Spinner className="size-3" /> Syncing
      </Badge>
    )
  return (
    <div className="flex w-28 items-center gap-2">
      <Progress value={doc.progress ?? 30} className="h-1" />
      <span className="text-muted-foreground text-xs capitalize">{doc.status}</span>
    </div>
  )
}

export function DocumentsView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const docs = useOrbit((s) => s.docs)
  const folders = useOrbit((s) => s.folders)
  const sites = useOrbit((s) => s.sites)
  const updateDoc = useOrbit((s) => s.updateDoc)
  const removeDoc = useOrbit((s) => s.removeDoc)
  const createSession = useOrbit((s) => s.createSession)

  const [currentFolderId, setCurrentFolderId] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [sort, setSort] = React.useState<SortKey>("updated")
  const [view, setView] = React.useState<"list" | "grid">("list")
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [previewDocId, setPreviewDocId] = React.useState<string | null>(null)
  const [folderDialog, setFolderDialog] = React.useState<{
    open: boolean
    folder: DocFolder | null
    parentId: string | null
  }>({ open: false, folder: null, parentId: null })
  const [deleteFolder, setDeleteFolder] = React.useState<DocFolder | null>(null)
  const [shareFolder, setShareFolder] = React.useState<DocFolder | null>(null)
  const [treeSheetOpen, setTreeSheetOpen] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [docWindow, setDocWindow] = React.useState(200)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const liveUserEmail = useOrbit((s) => (s.liveUserEmail ?? "").toLowerCase())
  const patchFolder = useOrbit((s) => s.patchFolder)

  const folderActions: FolderActions = React.useMemo(
    () => ({
      onNewSubfolder: (parentId) =>
        setFolderDialog({ open: true, folder: null, parentId }),
      onEdit: (folder) =>
        setFolderDialog({ open: true, folder, parentId: folder.parentId }),
      onShare: (folder) => setShareFolder(folder),
      onDelete: (folder) => setDeleteFolder(folder),
    }),
    []
  )

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const bulkDelete = () => {
    const ids = [...selectedIds]
    ids.forEach((id) => removeDoc(id))
    setSelectedIds(new Set())
    toast(`Deleted ${ids.length} ${ids.length === 1 ? "document" : "documents"}`)
  }

  const bulkAddToFolder = (folderId: string) => {
    const ids = [...selectedIds]
    ids.forEach((id) => {
      updateDoc(id, { folderId })
      syncMoveDoc(id, folderId)
    })
    setSelectedIds(new Set())
    const name = folders.find((f) => f.id === folderId)?.name ?? "folder"
    toast(`Added ${ids.length} ${ids.length === 1 ? "document" : "documents"} to ${name}`)
  }

  const loadMore = async () => {
    const next = docWindow + 300
    // If the store already holds more rows than we're showing, just grow the
    // render window (no fetch). Only hit the server for additional live pages
    // when we've exhausted what's loaded.
    const needsFetch = !query && !currentFolderId && docs.length <= docWindow
    if (!needsFetch) {
      setDocWindow(next)
      return
    }
    setLoadingMore(true)
    try {
      await loadMoreLiveDocs(next)
      setDocWindow(next)
    } catch (error) {
      toast.error("Couldn't load more documents", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setLoadingMore(false)
    }
  }

  /* deep links: /documents?upload=1, ?doc=<id>, ?folder=<id> */
  React.useEffect(() => {
    if (searchParams.get("upload")) setUploadOpen(true)
    const docParam = searchParams.get("doc")
    if (docParam) setPreviewDocId(docParam)
    const folderParam = searchParams.get("folder")
    if (folderParam) setCurrentFolderId(folderParam)
  }, [searchParams])

  const currentFolder = folders.find((f) => f.id === currentFolderId)
  const site = sites.find((s) => s.mappedFolderId === currentFolderId)

  /** Move a doc between folders (null = out of any folder). */
  const moveDocToFolder = (doc: Doc, folderId: string | null) => {
    updateDoc(doc.id, { folderId })
    syncMoveDoc(doc.id, folderId)
    toast(
      folderId
        ? `Moved to ${folders.find((f) => f.id === folderId)?.name ?? "folder"}`
        : "Removed from folder",
      { description: doc.name }
    )
  }

  const canShareCurrentFolder =
    currentFolder && currentFolder.source === "upload"

  const saveFolderShare = async (emails: string[]) => {
    const target = shareFolder
    if (!target) return
    const creator = (target.createdBy ?? liveUserEmail).toLowerCase()
    const accessEmails = [creator, ...emails.filter((e) => e.toLowerCase() !== creator)]
    patchFolder(target.id, { accessEmails })
    syncUpdateFolder(target.id, { accessEmails })
    toast.success("Folder sharing updated", {
      description:
        emails.length === 0
          ? "Only you can see this folder now."
          : `Shared with ${emails.length} ${emails.length === 1 ? "person" : "people"}.`,
    })
  }

  const descendantIds = React.useMemo(() => {
    if (!currentFolderId) return null
    const ids = new Set<string>([currentFolderId])
    let changed = true
    while (changed) {
      changed = false
      for (const f of folders) {
        if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
          ids.add(f.id)
          changed = true
        }
      }
    }
    return ids
  }, [currentFolderId, folders])

  // Live mode: the store holds only the newest page of the corpus, so a
  // query also searches the whole ontology server-side. Server hits merge
  // into the same list (only when browsing the root — folder views stay
  // local to their contents).
  const { results: serverHits, searching } = useLiveDocSearch(
    currentFolderId ? "" : query
  )

  // Memoized filter+sort chain — otherwise it re-runs (and re-sorts the whole
  // list) on every render, including selection toggles, hover, and dialog open.
  const visible = React.useMemo(() => {
    const q = query.toLowerCase()
    return docs
      .filter(
        (d) =>
          (!descendantIds || (d.folderId && descendantIds.has(d.folderId))) &&
          (!query ||
            d.name.toLowerCase().includes(q) ||
            d.tags.some((t) => t.includes(q)))
      )
      .concat(query && !currentFolderId ? serverHits : [])
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name)
        if (sort === "size") return b.sizeKB - a.sizeKB
        return b.updatedAt.localeCompare(a.updatedAt)
      })
  }, [docs, descendantIds, query, serverHits, currentFolderId, sort])

  // Cap mounted rows to the current window. Each row wraps a Radix ContextMenu,
  // so rendering the full corpus at once is the heaviest cost on this route;
  // "Load more" grows the window on demand.
  const rendered = React.useMemo(
    () => visible.slice(0, docWindow),
    [visible, docWindow]
  )

  const previewDoc =
    docs.find((d) => d.id === previewDocId) ??
    serverHits.find((d) => d.id === previewDocId) ??
    null

  /* Full ancestor chain (Library / A / B / C), cycle-guarded. */
  const breadcrumbSegments = React.useMemo(() => {
    const segments: { id: string | null; name: string }[] = []
    let cursor: DocFolder | undefined = currentFolder
    const visited = new Set<string>()
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id)
      segments.unshift({ id: cursor.id, name: cursor.name })
      cursor = folders.find((f) => f.id === cursor?.parentId)
    }
    return [{ id: null as string | null, name: "Library" }, ...segments]
  }, [currentFolder, folders])

  /* Direct child folders of the current view — rendered as tiles in the
     content pane so nesting is navigable from the main area, not just the
     side tree. */
  const childFolders = React.useMemo(
    () =>
      folders
        .filter(
          (f) =>
            f.source !== "sharepoint" &&
            (f.parentId ?? null) === currentFolderId
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, currentFolderId]
  )
  const directDocCount = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of docs) {
      if (!d.folderId) continue
      counts.set(d.folderId, (counts.get(d.folderId) ?? 0) + 1)
    }
    return counts
  }, [docs])

  /* "A / B / C" path labels so flat folder menus stay unambiguous with
     nesting; sorted so parents come right before their children. */
  const folderPaths = React.useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]))
    const paths = new Map<string, string>()
    const pathOf = (folder: DocFolder): string => {
      const cached = paths.get(folder.id)
      if (cached) return cached
      const names: string[] = []
      let cursor: DocFolder | undefined = folder
      const visited = new Set<string>()
      while (cursor && !visited.has(cursor.id)) {
        visited.add(cursor.id)
        names.unshift(cursor.name)
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
      }
      const path = names.join(" / ")
      paths.set(folder.id, path)
      return path
    }
    for (const f of folders) pathOf(f)
    return paths
  }, [folders])
  const uploadFoldersByPath = React.useMemo(
    () =>
      folders
        .filter((f) => f.source === "upload")
        .sort((a, b) =>
          (folderPaths.get(a.id) ?? a.name).localeCompare(
            folderPaths.get(b.id) ?? b.name
          )
        ),
    [folders, folderPaths]
  )

  const askInChat = (doc: Doc) => {
    // Server-search hits aren't in the store yet — adopt before scoping.
    adoptSearchResult(doc)
    createSession([doc.id])
    router.push("/chat")
    toast("New session scoped to this document", { description: doc.name })
  }

  const rowMenu = (doc: Doc) => (
    <ContextMenuContent className="w-52">
      <ContextMenuItem onClick={() => setPreviewDocId(doc.id)}>
        <Search /> Preview & details
      </ContextMenuItem>
      <ContextMenuItem onClick={() => askInChat(doc)}>
        <MessageSquarePlus /> Ask in chat
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => toast("Link copied to clipboard", { description: doc.name })}
      >
        <Link2 /> Copy link
      </ContextMenuItem>
      {doc.source !== "sharepoint" && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInput className="text-muted-foreground mr-2 size-4" /> Move to
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {doc.folderId && (
              <ContextMenuItem onClick={() => void moveDocToFolder(doc, null)}>
                Library (no folder)
              </ContextMenuItem>
            )}
            {uploadFoldersByPath.flatMap((f) =>
              f.id !== doc.folderId
                ? [
                    <ContextMenuItem
                      key={f.id}
                      onClick={() => void moveDocToFolder(doc, f.id)}
                    >
                      {folderPaths.get(f.id) ?? f.name}
                    </ContextMenuItem>,
                  ]
                : []
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        onClick={() => {
          removeDoc(doc.id)
          toast("Document deleted", {
            description: doc.name,
            action: { label: "Undo", onClick: () => useOrbit.getState().addDoc(doc) },
          })
        }}
      >
        <Trash2 /> Delete
      </ContextMenuItem>
    </ContextMenuContent>
  )

  return (
    <div className="flex min-h-0 flex-1">
      {/* Folder tree — fixed rail on desktop, sheet on mobile */}
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r p-3 md:block">
        <FolderTree
          currentFolderId={currentFolderId}
          onSelect={setCurrentFolderId}
          actions={folderActions}
        />
      </aside>
      <Sheet open={treeSheetOpen} onOpenChange={setTreeSheetOpen}>
        <SheetContent side="left" className="w-72 p-3 pt-10">
          <SheetTitle className="sr-only">Folders</SheetTitle>
          <div className="overflow-y-auto">
            <FolderTree
              currentFolderId={currentFolderId}
              onSelect={(id) => {
                setCurrentFolderId(id)
                setTreeSheetOpen(false)
              }}
              actions={folderActions}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:gap-3">
          <Button
            variant="outline"
            size="icon-sm"
            className="md:hidden"
            aria-label="Browse folders"
            onClick={() => setTreeSheetOpen(true)}
          >
            <FolderTreeIcon />
          </Button>
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbSegments.map((seg, i) => {
                const isLast = i === breadcrumbSegments.length - 1
                return (
                  <React.Fragment key={seg.id ?? "root"}>
                    {i > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage>{seg.name}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink
                          className="cursor-pointer"
                          onClick={() => setCurrentFolderId(seg.id)}
                        >
                          {seg.name}
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </React.Fragment>
                )
              })}
            </BreadcrumbList>
          </Breadcrumb>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                placeholder="Filter by name or tag…"
                className="h-8 w-40 pl-8 sm:w-56"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <ArrowUpDown />
                  <span className="hidden sm:inline">
                    {sort === "updated" ? "Last modified" : sort === "name" ? "Name" : "Size"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSort("updated")}>
                  Last modified
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSort("name")}>
                  Name
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSort("size")}>
                  Size
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={view}
              onValueChange={(v) => v && setView(v as "list" | "grid")}
            >
              <ToggleGroupItem value="list" aria-label="List view">
                <List />
              </ToggleGroupItem>
              <ToggleGroupItem value="grid" aria-label="Grid view">
                <LayoutGrid />
              </ToggleGroupItem>
            </ToggleGroup>
            {canShareCurrentFolder && currentFolder && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShareFolder(currentFolder)}
              >
                <Users />
                <span className="hidden sm:inline">
                  Share
                  {(currentFolder.accessEmails?.length ?? 1) > 1 &&
                    ` (${(currentFolder.accessEmails?.length ?? 1) - 1})`}
                </span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setFolderDialog({
                  open: true,
                  folder: null,
                  parentId:
                    currentFolder?.source === "upload" ? currentFolder.id : null,
                })
              }
            >
              <FolderPlus /> <span className="hidden sm:inline">New folder</span>
            </Button>
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Upload /> <span className="hidden sm:inline">Upload</span>
            </Button>
          </div>
        </div>

        {/* SharePoint banner */}
        {site && (
          <div className="bg-muted/50 flex items-center gap-3 border-b px-4 py-2">
            <Cloud className="size-4 text-sky-600 dark:text-sky-400" />
            <p className="text-sm">
              Synced from{" "}
              <span className="font-medium">{currentFolder?.sharePointPath}</span>
            </p>
            <span className="text-muted-foreground text-xs">
              Last synced <TimeAgo iso={site.lastSyncedAt} />
            </span>
            {site.attentionCount > 0 && (
              <Badge variant="destructive" className="ml-auto tabular-nums">
                {site.attentionCount} conflicts
              </Badge>
            )}
          </div>
        )}

        {/* Content */}
        {selectedIds.size > 0 && (
          <div className="bg-muted/60 flex items-center gap-2 border-b px-4 py-2 text-sm">
            <span className="font-medium tabular-nums">
              {selectedIds.size} selected
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7">
                  Add to folder
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {uploadFoldersByPath.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    onClick={() => void bulkAddToFolder(f.id)}
                  >
                    {folderPaths.get(f.id) ?? f.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive h-7"
              onClick={bulkDelete}
            >
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground ml-auto h-7"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Subfolders of the current view — navigable from the main pane. */}
          {!query && childFolders.length > 0 && (
            <div className="grid grid-cols-1 gap-2 border-b p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {childFolders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setCurrentFolderId(f.id)}
                  className="group/folder hover:bg-accent flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm"
                >
                  <span className="relative shrink-0">
                    <Folder className="text-muted-foreground size-4" />
                    <span
                      className={cn(
                        "absolute -right-0.5 -bottom-0.5 size-2 rounded-full",
                        folderSwatchClass(f.color)
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {f.name}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {directDocCount.get(f.id) ?? 0}
                  </span>
                  <ChevronRight className="text-muted-foreground size-3.5 opacity-0 transition-opacity group-hover/folder:opacity-100" />
                </button>
              ))}
            </div>
          )}
          {visible.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle>
                  {searching ? "Searching your library…" : "No documents found"}
                </EmptyTitle>
                <EmptyDescription>
                  {searching
                    ? "Checking all documents on Foundry."
                    : query
                      ? `Nothing matches “${query}” in this folder.`
                      : childFolders.length > 0
                        ? "No documents here yet — browse a subfolder above or upload files."
                        : "This folder is empty. Upload files to get started."}
                </EmptyDescription>
              </EmptyHeader>
              <Button onClick={() => setUploadOpen(true)}>
                <Upload /> Upload documents
              </Button>
            </Empty>
          ) : view === "list" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      aria-label="Select all visible"
                      checked={
                        visible.length > 0 &&
                          visible.every((d) => selectedIds.has(d.id))
                          ? true
                          : selectedIds.size > 0
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={(v) =>
                        setSelectedIds(
                          v === true ? new Set(visible.map((d) => d.id)) : new Set()
                        )
                      }
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-36">Status</TableHead>
                  <TableHead className="hidden w-36 lg:table-cell">Owner</TableHead>
                  <TableHead className="hidden w-28 sm:table-cell">Modified</TableHead>
                  <TableHead className="hidden w-20 text-right md:table-cell">Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rendered.map((doc) => (
                  <ContextMenu key={doc.id}>
                    <ContextMenuTrigger asChild>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setPreviewDocId(doc.id)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label={`Select ${doc.name}`}
                            checked={selectedIds.has(doc.id)}
                            onCheckedChange={() => toggleSelected(doc.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <DocIcon type={doc.type} />
                            <span className="max-w-md truncate font-medium">
                              {doc.name}
                            </span>
                            {doc.source === "sharepoint" && (
                              <Cloud className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusCell doc={doc} />
                        </TableCell>
                        <TableCell className="text-muted-foreground hidden lg:table-cell">
                          {doc.owner}
                        </TableCell>
                        <TableCell className="text-muted-foreground hidden sm:table-cell">
                          <TimeAgo iso={doc.updatedAt} />
                        </TableCell>
                        <TableCell className="text-muted-foreground hidden text-right tabular-nums md:table-cell">
                          {formatSize(doc.sizeKB)}
                        </TableCell>
                      </TableRow>
                    </ContextMenuTrigger>
                    {rowMenu(doc)}
                  </ContextMenu>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {rendered.map((doc) => (
                <ContextMenu key={doc.id}>
                  <ContextMenuTrigger asChild>
                    <Card
                      className="cursor-pointer gap-3 p-4 transition-shadow hover:shadow-md"
                      onClick={() => setPreviewDocId(doc.id)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="bg-muted rounded-md p-2.5">
                          <DocIcon type={doc.type} className="size-5" />
                        </div>
                        <StatusCell doc={doc} />
                      </div>
                      <div>
                        <p className="line-clamp-2 text-sm leading-snug font-medium">
                          {doc.name}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {docTypeLabel(doc.type)} · {doc.pages} pages ·{" "}
                          {formatSize(doc.sizeKB)}
                        </p>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {doc.owner} · <TimeAgo iso={doc.updatedAt} />
                      </p>
                    </Card>
                  </ContextMenuTrigger>
                  {rowMenu(doc)}
                </ContextMenu>
              ))}
            </div>
          )}
          {/* Show when more rows can be revealed locally, or (root view)
              when the server may hold further pages. */}
          {(rendered.length < visible.length ||
            (!query && !currentFolderId && docs.length <= docWindow)) && (
              <div className="flex justify-center p-4">
                <Button variant="outline" size="sm" disabled={loadingMore} onClick={loadMore}>
                  {loadingMore ? "Loading…" : "Load more documents"}
                </Button>
              </div>
            )}
        </div>

        <div className="text-muted-foreground border-t px-4 py-1.5 text-xs">
          {rendered.length < visible.length
            ? `Showing ${rendered.length} of ${visible.length} documents`
            : `${visible.length} ${visible.length === 1 ? "document" : "documents"}`}
          {currentFolder ? ` in ${currentFolder.name}` : " in library"} · right-click
          a row for quick actions
        </div>
      </main>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        defaultFolderId={
          currentFolder?.source === "upload" ? currentFolder.id : undefined
        }
      />
      <DocPreviewSheet
        doc={previewDoc}
        open={previewDocId !== null}
        onOpenChange={(open) => !open && setPreviewDocId(null)}
      />
      {shareFolder && (
        <ShareDialog
          open={shareFolder !== null}
          onOpenChange={(open) => !open && setShareFolder(null)}
          title={`Share “${shareFolder.name}”`}
          description="People you add can see every document in this folder and use it to ground their chats. Email matching is case-insensitive."
          ownerEmail={shareFolder.createdBy ?? liveUserEmail}
          emails={(shareFolder.accessEmails ?? []).filter(
            (e) => e.toLowerCase() !== (shareFolder.createdBy ?? liveUserEmail).toLowerCase()
          )}
          onSave={saveFolderShare}
        />
      )}

      <DocFolderDialog
        open={folderDialog.open}
        onOpenChange={(open) =>
          setFolderDialog((prev) => ({ ...prev, open }))
        }
        folder={folderDialog.folder}
        parentId={folderDialog.parentId}
        parentName={
          folderDialog.parentId
            ? folders.find((f) => f.id === folderDialog.parentId)?.name
            : undefined
        }
      />
      <DeleteDocFolderDialog
        open={deleteFolder !== null}
        onOpenChange={(open) => !open && setDeleteFolder(null)}
        folder={deleteFolder}
      />
    </div>
  )
}
