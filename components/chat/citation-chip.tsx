"use client"

import { FileSearch } from "lucide-react"

import { DocIcon } from "@/components/doc-icon"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { useOrbit } from "@/lib/store"
import type { Citation } from "@/lib/types"

export function CitationChip({
  citation,
  onOpen,
}: {
  citation: Citation
  onOpen: (citation: Citation) => void
}) {
  const doc = useOrbit((s) =>
    s.docs.find(
      (d) =>
        (citation.docId && d.id === citation.docId) ||
        (citation.docName && d.name === citation.docName)
    )
  )
  // Live citations carry their own name (and sometimes a media rid) even
  // when the cited doc isn't in the user's library.
  const name = doc?.name ?? citation.docName
  if (!name) return null
  const pageLabel = citation.pagesLabel
    ? citation.pagesLabel.includes(",") || citation.pagesLabel.includes("-")
      ? `pp. ${citation.pagesLabel}`
      : `p. ${citation.pagesLabel}`
    : `p. ${citation.page}`

  return (
    <HoverCard openDelay={200} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button type="button"
          onClick={() => onOpen(citation)}
          aria-label={`Citation ${citation.n}: ${name}, ${pageLabel}`}
          className="bg-primary/8 text-primary hover:bg-primary/15 ring-primary/20 mx-0.5 inline-flex size-4.5 translate-y-[-1px] items-center justify-center rounded-full text-[10px] font-semibold ring-1 transition-colors dark:bg-primary/15 dark:hover:bg-primary/25"
        >
          {citation.n}
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-80" side="top">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {doc ? <DocIcon type={doc.type} /> : <FileSearch className="size-4" />}
            <p className="min-w-0 flex-1 truncate text-xs font-medium">{name}</p>
            <span className="text-muted-foreground shrink-0 text-xs">
              {pageLabel}
            </span>
          </div>
          {citation.quote && (
            <blockquote className="border-primary/40 text-muted-foreground border-l-2 pl-2.5 font-serif text-xs leading-relaxed italic">
              “{citation.quote}”
            </blockquote>
          )}
          <p className="text-muted-foreground flex items-center gap-1 text-[10px]">
            <FileSearch className="size-3" />
            Click to open the passage in the source PDF
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
