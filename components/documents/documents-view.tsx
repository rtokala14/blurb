"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowUpDown,
  Cloud,
  FolderInput,
  FolderPlus,
  FolderTree as FolderTreeIcon,
  LayoutGrid,
  Link2,
  List,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { DocIcon, docTypeLabel } from "@/components/doc-icon"
import { DocPreviewSheet } from "@/components/documents/doc-preview-sheet"
import { ShareDialog } from "@/components/share-dialog"
import { adoptSearchResult, useLiveDocSearch } from "@/hooks/use-live-doc-search"
import { loadMoreLiveDocs } from "@/components/live-provider"
import { liveApi } from "@/lib/live-api"
import { Checkbox } from "@/components/ui/checkbox"
import { FolderTree } from "@/components/documents/folder-tree"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { formatSize } from "@/lib/format"
import { TimeAgo } from "@/components/time-ago"
import { uid, useOrbit } from "@/lib/store"
import { useSharePointSync } from "@/lib/use-sharepoint-sync"
import type { Doc } from "@/lib/types"

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
  const addFolder = useOrbit((s) => s.addFolder)
  const createSession = useOrbit((s) => s.createSession)
  const syncSite = useSharePointSync()

  const [currentFolderId, setCurrentFolderId] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [sort, setSort] = React.useState<SortKey>("updated")
  const [view, setView] = React.useState<"list" | "grid">("list")
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [previewDocId, setPreviewDocId] = React.useState<string | null>(null)
  const [newFolderOpen, setNewFolderOpen] = React.useState(false)
  const [newFolderName, setNewFolderName] = React.useState("")
  const [treeSheetOpen, setTreeSheetOpen] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [docWindow, setDocWindow] = React.useState(200)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [shareOpen, setShareOpen] = React.useState(false)
  const live = useOrbit((s) => s.live === true)
  const liveUserEmail = useOrbit((s) => (s.liveUserEmail ?? "").toLowerCase())
  const patchFolder = useOrbit((s) => s.patchFolder)

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

  const bulkAddToFolder = async (folderId: string) => {
    const ids = [...selectedIds]
    try {
      // merge into the folder's current contents (fetched fresh — the store
      // doesn't hold contents arrays)
      const { data } = await liveApi.folders()
      const target = data.find((f) => f.primaryKey === folderId)
      if (!target) throw new Error("Folder not found")
      const merged = [...new Set([...target.contents, ...ids])]
      await liveApi.updateFolder(folderId, { contents: merged })
      ids.forEach((id) => updateDoc(id, { folderId }))
      setSelectedIds(new Set())
      toast(`Added ${ids.length} ${ids.length === 1 ? "document" : "documents"} to the folder`)
    } catch (error) {
      toast.error("Couldn't add to the folder", {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  const loadMore = async () => {
    const next = docWindow + 300
    // If the store already holds more rows than we're showing, just grow the
    // render window (no fetch). Only hit the server for additional live pages
    // when we've exhausted what's loaded.
    const needsFetch = live && !query && !currentFolderId && docs.length <= docWindow
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

  /** Create a folder — real OrbitFolders row in live mode, local in demo. */
  const createNewFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    if (live) {
      try {
        const created = await liveApi.createFolder({ name })
        addFolder({
          id: created.primaryKey,
          name: created.name,
          parentId: null,
          source: "upload",
          createdBy: created.createdBy,
          accessEmails: created.accessEmails,
        })
        toast.success("Folder created", { description: name })
      } catch (error) {
        toast.error("Couldn't create the folder", {
          description: error instanceof Error ? error.message : undefined,
        })
        return
      }
    } else {
      addFolder({
        id: uid("f"),
        name,
        parentId: currentFolder?.source === "upload" ? currentFolder.id : null,
        source: "upload",
      })
      toast.success("Folder created")
    }
    setNewFolderName("")
    setNewFolderOpen(false)
  }

  /** Move a doc between folders (null = out of any folder), persisted live. */
  const moveDocToFolder = async (doc: Doc, folderId: string | null) => {
    if (!live) {
      updateDoc(doc.id, { folderId })
      toast(folderId ? "Moved" : "Removed from folder", { description: doc.name })
      return
    }
    try {
      const { data } = await liveApi.folders()
      const containing = data.filter((f) => f.contents.includes(doc.id))
      for (const f of containing.filter((f) => f.primaryKey !== folderId)) {
        await liveApi.updateFolder(f.primaryKey, {
          contents: f.contents.filter((id) => id !== doc.id),
        })
      }
      if (folderId && !containing.some((f) => f.primaryKey === folderId)) {
        const target = data.find((f) => f.primaryKey === folderId)
        if (!target) throw new Error("Folder not found")
        await liveApi.updateFolder(folderId, {
          contents: [...new Set([...target.contents, doc.id])],
        })
      }
      updateDoc(doc.id, { folderId })
      toast(
        folderId
          ? `Moved to ${folders.find((f) => f.id === folderId)?.name ?? "folder"}`
          : "Removed from folder",
        { description: doc.name }
      )
    } catch (error) {
      toast.error("Couldn't move the document", {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  const canShareCurrentFolder =
    live &&
    currentFolder &&
    currentFolder.source === "upload" &&
    (currentFolder.createdBy ?? "").toLowerCase() === liveUserEmail

  const saveFolderShare = async (emails: string[]) => {
    if (!currentFolder) return
    const creator = (currentFolder.createdBy ?? liveUserEmail).toLowerCase()
    const accessEmails = [creator, ...emails.filter((e) => e !== creator)]
    await liveApi.updateFolder(currentFolder.id, { accessEmails })
    patchFolder(currentFolder.id, { accessEmails })
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
        (d) => !descendantIds || (d.folderId && descendantIds.has(d.folderId))
      )
      .filter(
        (d) =>
          !query ||
          d.name.toLowerCase().includes(q) ||
          d.tags.some((t) => t.includes(q))
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

  const breadcrumbSegments: { id: string | null; name: string }[] = [
    { id: null, name: "Library" },
  ]
  if (currentFolder) {
    if (currentFolder.parentId) {
      const parent = folders.find((f) => f.id === currentFolder.parentId)
      if (parent) breadcrumbSegments.push({ id: parent.id, name: parent.name })
    }
    breadcrumbSegments.push({ id: currentFolder.id, name: currentFolder.name })
  }

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
            {folders
              .filter((f) => f.source === "upload" && f.id !== doc.folderId)
              .map((f) => (
                <ContextMenuItem
                  key={f.id}
                  onClick={() => void moveDocToFolder(doc, f.id)}
                >
                  {f.name}
                </ContextMenuItem>
              ))}
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
            {canShareCurrentFolder && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShareOpen(true)}
              >
                <Users />
                <span className="hidden sm:inline">
                  Share
                  {(currentFolder?.accessEmails?.length ?? 1) > 1 &&
                    ` (${(currentFolder?.accessEmails?.length ?? 1) - 1})`}
                </span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewFolderOpen(true)}
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
              <Badge variant="destructive" className="tabular-nums">
                {site.attentionCount} conflicts
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              disabled={site.state === "syncing"}
              onClick={() => syncSite(site.id)}
            >
              {site.state === "syncing" ? (
                <>
                  <Spinner /> Syncing…
                </>
              ) : (
                <>
                  <RefreshCw /> Sync now
                </>
              )}
            </Button>
          </div>
        )}

        {/* Content */}
        {live && selectedIds.size > 0 && (
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
                {folders
                  .filter((f) => f.source !== "sharepoint")
                  .map((f) => (
                    <DropdownMenuItem
                      key={f.id}
                      onClick={() => void bulkAddToFolder(f.id)}
                    >
                      {f.name}
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
                      : "This folder is empty. Upload files or sync a SharePoint site."}
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
                  {live && (
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
                  )}
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
                        {live && (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              aria-label={`Select ${doc.name}`}
                              checked={selectedIds.has(doc.id)}
                              onCheckedChange={() => toggleSelected(doc.id)}
                            />
                          </TableCell>
                        )}
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
          {/* Show when more rows can be revealed locally, or (live root view)
              when the server may hold further pages. */}
          {(rendered.length < visible.length ||
            (live && !query && !currentFolderId && docs.length <= docWindow)) && (
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
      {currentFolder && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          title={`Share “${currentFolder.name}”`}
          description="People you add can see every document in this folder and use it to ground their chats. Email matching is case-insensitive."
          ownerEmail={currentFolder.createdBy ?? liveUserEmail}
          emails={(currentFolder.accessEmails ?? []).filter(
            (e) => e.toLowerCase() !== (currentFolder.createdBy ?? liveUserEmail).toLowerCase()
          )}
          onSave={saveFolderShare}
        />
      )}

      {/* New folder dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Create a folder{" "}
              {currentFolder && currentFolder.source === "upload"
                ? `inside “${currentFolder.name}”`
                : "at the top level"}
              .
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newFolderName.trim()) {
                void createNewFolder()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newFolderName.trim()}
              onClick={() => void createNewFolder()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
