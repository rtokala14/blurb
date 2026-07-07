"use client"

import * as React from "react"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Quote,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { toast } from "sonner"

import { DocIcon, docTypeLabel } from "@/components/doc-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { Doc } from "@/lib/types"

/** Deterministic PRNG so placeholder text lines are stable per doc+page. */
function seeded(seedStr: string) {
  let h = 1779033703
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

function PageLines({
  seed,
  count,
  highlighted,
}: {
  seed: string
  count: number
  highlighted?: boolean
}) {
  const rand = seeded(seed)
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-2 rounded-[2px]",
            highlighted ? "bg-amber-300/70 dark:bg-amber-500/50" : "bg-foreground/10"
          )}
          style={{ width: `${62 + rand() * 38}%` }}
        />
      ))}
    </div>
  )
}

function PdfPage({
  doc,
  page,
  quote,
  zoom,
}: {
  doc: Doc
  page: number
  quote?: string
  zoom: number
}) {
  return (
    <div
      className="mx-auto flex aspect-[8.5/11] flex-col border bg-white p-10 text-neutral-900 shadow-md transition-[width] dark:bg-neutral-100"
      style={{ width: `${zoom}%` }}
    >
      {page === 1 && (
        <div className="mb-8 space-y-2">
          <div className="bg-foreground/70 h-3.5 w-3/5 rounded-[2px]" />
          <div className="bg-foreground/30 h-2 w-2/5 rounded-[2px]" />
        </div>
      )}
      <div className="space-y-6">
        <PageLines seed={`${doc.id}-${page}-a`} count={5} />
        {quote ? (
          <div className="rounded-sm bg-amber-200/80 p-3 ring-2 ring-amber-400/70 dark:bg-amber-300/80">
            <p className="font-serif text-[11px] leading-relaxed text-neutral-900">
              {quote}
            </p>
          </div>
        ) : (
          <PageLines seed={`${doc.id}-${page}-b`} count={4} />
        )}
        <PageLines seed={`${doc.id}-${page}-c`} count={6} />
        <PageLines seed={`${doc.id}-${page}-d`} count={4} />
      </div>
      <div className="text-muted-foreground mt-auto flex items-center justify-between pt-6 text-[10px] text-neutral-500">
        <span className="truncate pr-4">{doc.name}</span>
        <span>Page {page}</span>
      </div>
    </div>
  )
}

export function PdfViewerDialog({
  doc,
  page,
  quote,
  citationLabel,
  open,
  onOpenChange,
}: {
  doc: Doc | null
  page?: number
  quote?: string
  citationLabel?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [currentPage, setCurrentPage] = React.useState(page ?? 1)
  const [zoom, setZoom] = React.useState(72)

  React.useEffect(() => {
    if (open) setCurrentPage(page ?? 1)
  }, [open, page])

  if (!doc) return null
  const totalPages = doc.pages

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            <DocIcon type={doc.type} />
            <span className="truncate">{doc.name}</span>
            <Badge variant="outline" className="ml-1">
              {docTypeLabel(doc.type)}
            </Badge>
            {citationLabel && (
              <Badge variant="secondary" className="gap-1">
                <Quote className="size-3" /> {citationLabel}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Document preview for {doc.name}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* Thumbnail rail */}
          <div className="w-24 shrink-0 border-r">
            <ScrollArea className="h-full">
              <div className="space-y-2 p-3">
                {Array.from({ length: Math.min(totalPages, 12) }, (_, i) => {
                  const p = i + 1
                  return (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={cn(
                        "block w-full overflow-hidden rounded-sm border bg-white p-1.5 dark:bg-neutral-200",
                        currentPage === p
                          ? "ring-primary ring-2"
                          : "hover:ring-muted-foreground/40 hover:ring-1"
                      )}
                      aria-label={`Go to page ${p}`}
                    >
                      <div className="space-y-1">
                        {Array.from({ length: 6 }, (_, j) => (
                          <div
                            key={j}
                            className={cn(
                              "h-0.5 rounded-full",
                              quote && p === page && j === 2
                                ? "bg-amber-400"
                                : "bg-neutral-300"
                            )}
                          />
                        ))}
                      </div>
                      <p className="mt-1 text-center text-[9px] text-neutral-500">
                        {p}
                      </p>
                    </button>
                  )
                })}
                {totalPages > 12 && (
                  <p className="text-muted-foreground text-center text-[10px]">
                    +{totalPages - 12} more
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Page canvas */}
          <div className="bg-muted/50 min-w-0 flex-1">
            <ScrollArea className="h-full">
              <div className="p-6">
                <PdfPage
                  doc={doc}
                  page={currentPage}
                  quote={currentPage === page ? quote : undefined}
                  zoom={zoom}
                />
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1 border-t px-4 py-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft />
          </Button>
          <span className="text-muted-foreground w-24 text-center text-xs tabular-nums">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight />
          </Button>
          <Separator orientation="vertical" className="mx-2 !h-4" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(48, z - 12))}
          >
            <ZoomOut />
          </Button>
          <span className="text-muted-foreground w-10 text-center text-xs tabular-nums">
            {Math.round(zoom * 1.4)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(100, z + 12))}
          >
            <ZoomIn />
          </Button>
          <div className="ml-auto">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toast("Download started", { description: doc.name })}
                >
                  <Download /> Download
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download original file</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
