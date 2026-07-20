"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import {
  Clock,
  Cloud,
  Eye,
  MessageSquarePlus,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { DocIcon } from "@/components/doc-icon"
import { docTypeLabel } from "@/components/doc-icon-config"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { formatDate, formatSize } from "@/lib/format"
import { TimeAgo } from "@/components/time-ago"
import { versionsFor } from "@/lib/data"
import { useOrbit } from "@/lib/store"
import type { Doc, DocStatus } from "@/lib/types"

// PDF viewers are only needed once a user actually opens a preview — keep them
// out of the documents route's initial bundle.
const LivePdfDialog = dynamic(
  () => import("@/components/live-pdf-dialog").then((m) => m.LivePdfDialog),
  { ssr: false }
)
const PdfViewerDialog = dynamic(
  () => import("@/components/pdf-viewer-dialog").then((m) => m.PdfViewerDialog),
  { ssr: false }
)

const statusVariant: Record<
  DocStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  ready: { label: "Ready", variant: "secondary" },
  uploading: { label: "Uploading", variant: "outline" },
  processing: { label: "Processing", variant: "outline" },
  indexing: { label: "Indexing", variant: "outline" },
  syncing: { label: "Syncing", variant: "outline" },
  error: { label: "Needs attention", variant: "destructive" },
}

export function DocPreviewSheet({
  doc,
  open,
  onOpenChange,
}: {
  doc: Doc | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const folders = useOrbit((s) => s.folders)
  const removeDoc = useOrbit((s) => s.removeDoc)
  const createSession = useOrbit((s) => s.createSession)
  const [viewerOpen, setViewerOpen] = React.useState(false)

  if (!doc) return null
  const folder = folders.find((f) => f.id === doc.folderId)
  const status = statusVariant[doc.status]

  const askInChat = () => {
    createSession([doc.id])
    onOpenChange(false)
    router.push("/chat")
    toast("New session scoped to this document", { description: doc.name })
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full gap-0 sm:w-[420px] sm:max-w-[420px]">
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-start gap-2.5 pr-6 text-left leading-snug">
              <DocIcon type={doc.type} className="mt-0.5 size-5" />
              {doc.name}
            </SheetTitle>
            <SheetDescription className="flex items-center gap-2">
              <Badge variant={status.variant}>{status.label}</Badge>
              {doc.source === "sharepoint" && (
                <Badge variant="outline" className="gap-1">
                  <Cloud className="size-3 text-sky-600 dark:text-sky-400" />
                  SharePoint
                </Badge>
              )}
              <span className="text-xs">v{doc.version}</span>
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 p-4">
              {doc.status !== "ready" && doc.progress !== undefined && (
                <div className="space-y-1.5 rounded-md border p-3">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium capitalize">{doc.status}…</span>
                    <span className="text-muted-foreground tabular-nums">
                      {Math.round(doc.progress)}%
                    </span>
                  </div>
                  <Progress value={doc.progress} className="h-1.5" />
                </div>
              )}

              <div>
                <h4 className="mb-1.5 text-sm font-medium">AI summary</h4>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {doc.summary}
                </p>
              </div>

              <Separator />

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs">Type</dt>
                  <dd>{docTypeLabel(doc.type)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Size</dt>
                  <dd>{formatSize(doc.sizeKB)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Pages</dt>
                  <dd>{doc.pages}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Owner</dt>
                  <dd>{doc.owner}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Folder</dt>
                  <dd>{folder?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Updated</dt>
                  <dd><TimeAgo iso={doc.updatedAt} /></dd>
                </div>
              </dl>

              {folder?.sharePointPath && (
                <p className="text-muted-foreground bg-muted rounded-md p-2 font-mono text-xs">
                  {folder.sharePointPath}
                </p>
              )}

              {doc.tags.length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-sm font-medium">Tags</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {doc.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <Clock className="text-muted-foreground size-3.5" />
                  Version history
                </h4>
                <div className="space-y-3">
                  {versionsFor(doc).map((v) => (
                    <div key={v.version} className="flex gap-3 text-sm">
                      <Badge
                        variant={v.version === doc.version ? "default" : "outline"}
                        className="h-5 shrink-0 tabular-nums"
                      >
                        v{v.version}
                      </Badge>
                      <div className="min-w-0">
                        <p className="leading-tight">{v.note}</p>
                        <p className="text-muted-foreground text-xs">
                          {v.author} · {formatDate(v.date)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>

          <SheetFooter className="flex-row border-t">
            <Button className="flex-1" onClick={askInChat}>
              <MessageSquarePlus /> Ask in chat
            </Button>
            <Button
              variant="outline"
              onClick={() => setViewerOpen(true)}
              disabled={doc.status === "error"}
            >
              <Eye /> Preview
            </Button>
            {doc.status === "error" ? (
              <Button
                variant="outline"
                size="icon"
                aria-label="Retry OCR"
                onClick={() => toast("Re-queued for OCR", { description: doc.name })}
              >
                <RefreshCw />
              </Button>
            ) : (
              <Button
                variant="outline"
                size="icon"
                aria-label="Delete document"
                onClick={() => {
                  removeDoc(doc.id)
                  onOpenChange(false)
                  toast("Document deleted", {
                    description: doc.name,
                    action: { label: "Undo", onClick: () => useOrbit.getState().addDoc(doc) },
                  })
                }}
              >
                <Trash2 />
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {doc.mediaRid ? (
        <LivePdfDialog
          citation={{
            n: 0,
            docId: doc.id,
            page: 1,
            quote: "",
            mediaRid: doc.mediaRid,
            docName: doc.name,
          }}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
        />
      ) : (
        <PdfViewerDialog
          doc={doc}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
        />
      )}
    </>
  )
}
