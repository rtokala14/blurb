"use client"

import * as React from "react"
import { Download, FileType2, Loader2, Quote } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Citation } from "@/lib/types"

/**
 * Renders the real source PDF for a live citation. Streams the media item
 * from /api/orbit/media/{rid}/content, blob-caches it, and points the native
 * PDF viewer at the cited page (+ text search when a quote exists).
 */

// Bounded LRU of object URLs. Reopening a recently-viewed PDF is instant, but
// we cap the cache and `revokeObjectURL` on eviction so blobs don't leak for
// the whole session (each cached PDF holds its bytes in memory otherwise).
const BLOB_CACHE_LIMIT = 6
const blobCache = new Map<string, string>()

function getCachedBlobUrl(key: string): string | undefined {
  const url = blobCache.get(key)
  if (url) {
    // refresh recency
    blobCache.delete(key)
    blobCache.set(key, url)
  }
  return url
}

function setCachedBlobUrl(key: string, url: string) {
  blobCache.set(key, url)
  while (blobCache.size > BLOB_CACHE_LIMIT) {
    const oldest = blobCache.keys().next().value
    if (oldest === undefined) break
    const evicted = blobCache.get(oldest)
    blobCache.delete(oldest)
    if (evicted) URL.revokeObjectURL(evicted)
  }
}

export function LivePdfDialog({
  citation,
  open,
  onOpenChange,
}: {
  citation: Citation | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [url, setUrl] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const mediaRid = citation?.mediaRid
  React.useEffect(() => {
    if (!open || !mediaRid) return
    const cached = getCachedBlobUrl(mediaRid)
    if (cached) {
      setUrl(cached)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/orbit/media/${encodeURIComponent(mediaRid)}/content`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load PDF (${res.status})`)
        const blob = await res.blob()
        const objectUrl = URL.createObjectURL(blob)
        setCachedBlobUrl(mediaRid, objectUrl)
        if (!cancelled) setUrl(objectUrl)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, mediaRid])

  if (!citation) return null

  const fragment = (() => {
    const parts: string[] = []
    if (citation.page > 0) parts.push(`page=${citation.page}`)
    if (citation.quote) parts.push(`search=${encodeURIComponent(citation.quote)}`)
    return parts.length ? `#${parts.join("&")}` : ""
  })()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            <FileType2 className="size-4 text-red-600 dark:text-red-400" />
            <span className="truncate">{citation.docName ?? "Source document"}</span>
            <Badge variant="secondary" className="gap-1">
              <Quote className="size-3" /> Citation {citation.n}
            </Badge>
            {citation.pagesLabel && (
              <Badge variant="outline">p. {citation.pagesLabel}</Badge>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Source PDF for citation {citation.n}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted/40 relative min-h-0 flex-1">
          {loading && (
            <div className="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm">
              <Loader2 className="size-5 animate-spin" />
              Loading source PDF…
            </div>
          )}
          {error && (
            <div className="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm">
              <p>{error}</p>
              <p className="text-xs">
                The document may have been removed or you may not have access.
              </p>
            </div>
          )}
          {url && !error && (
            <iframe
              key={mediaRid}
              src={`${url}${fragment}`}
              title={citation.docName ?? "Source PDF"}
              className="h-full w-full"
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-2">
          {citation.quote ? (
            <p className="text-muted-foreground line-clamp-1 max-w-lg font-serif text-xs italic">
              “{citation.quote}”
            </p>
          ) : (
            <span />
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!url}
            onClick={() => {
              if (!url) return
              const a = document.createElement("a")
              a.href = url
              a.download = `${(citation.docName ?? "document").replace(/\.pdf$/i, "")}.pdf`
              a.click()
              toast("Download started")
            }}
          >
            <Download /> Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
