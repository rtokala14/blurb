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
} from "lucide-react"
import { toast } from "sonner"

import { DocIcon, docTypeLabel } from "@/components/doc-icon"
import { DocPreviewSheet } from "@/components/documents/doc-preview-sheet"
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

  /* deep links: /documents?upload=1 and /documents?doc=<id> */
  React.useEffect(() => {
    if (searchParams.get("upload")) setUploadOpen(true)
    const docParam = searchParams.get("doc")
    if (docParam) setPreviewDocId(docParam)
  }, [searchParams])

  const currentFolder = folders.find((f) => f.id === currentFolderId)
  const site = sites.find((s) => s.mappedFolderId === currentFolderId)

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

  const visible = docs
    .filter((d) => !descendantIds || (d.folderId && descendantIds.has(d.folderId)))
    .filter(
      (d) =>
        !query ||
        d.name.toLowerCase().includes(query.toLowerCase()) ||
        d.tags.some((t) => t.includes(query.toLowerCase()))
    )
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name)
      if (sort === "size") return b.sizeKB - a.sizeKB
      return b.updatedAt.localeCompare(a.updatedAt)
    })

  const previewDoc = docs.find((d) => d.id === previewDocId) ?? null

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
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <FolderInput className="text-muted-foreground mr-2 size-4" /> Move to
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {folders
            .filter((f) => f.source === "upload" && f.id !== doc.folderId)
            .map((f) => (
              <ContextMenuItem
                key={f.id}
                onClick={() => {
                  updateDoc(doc.id, { folderId: f.id })
                  toast(`Moved to ${f.name}`, { description: doc.name })
                }}
              >
                {f.name}
              </ContextMenuItem>
            ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle>No documents found</EmptyTitle>
                <EmptyDescription>
                  {query
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
                  <TableHead>Name</TableHead>
                  <TableHead className="w-36">Status</TableHead>
                  <TableHead className="hidden w-36 lg:table-cell">Owner</TableHead>
                  <TableHead className="hidden w-28 sm:table-cell">Modified</TableHead>
                  <TableHead className="hidden w-20 text-right md:table-cell">Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((doc) => (
                  <ContextMenu key={doc.id}>
                    <ContextMenuTrigger asChild>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setPreviewDocId(doc.id)}
                      >
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
              {visible.map((doc) => (
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
        </div>

        <div className="text-muted-foreground border-t px-4 py-1.5 text-xs">
          {visible.length} {visible.length === 1 ? "document" : "documents"}
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
                addFolder({
                  id: uid("f"),
                  name: newFolderName.trim(),
                  parentId:
                    currentFolder?.source === "upload" ? currentFolder.id : null,
                  source: "upload",
                })
                setNewFolderName("")
                setNewFolderOpen(false)
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newFolderName.trim()}
              onClick={() => {
                addFolder({
                  id: uid("f"),
                  name: newFolderName.trim(),
                  parentId:
                    currentFolder?.source === "upload" ? currentFolder.id : null,
                  source: "upload",
                })
                setNewFolderName("")
                setNewFolderOpen(false)
                toast.success("Folder created")
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
