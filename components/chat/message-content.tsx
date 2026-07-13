"use client"

import * as React from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"
import type { Citation } from "@/lib/types"

/**
 * GFM markdown renderer for chat messages, styled by shadcn/typeset
 * (app/typeset.css + the .typeset-chat preset in globals.css): headings,
 * lists, tables, code, quotes and links all follow the app theme with
 * streaming-stable spacing. Inline citation markers ⟦n⟧ are rewritten to
 * `#cite-n` links and rendered as citation chips via `renderCitation`.
 */

const CITE_HREF = "#cite-"

/** ⟦n⟧ → [⟦n⟧](#cite-n) so the marker survives markdown parsing intact. */
function markCitations(content: string): string {
  return content.replace(/⟦(\d+)⟧/g, "[⟦$1⟧](#cite-$1)")
}

export function MessageContent({
  content,
  citations,
  renderCitation,
  streaming,
  className,
}: {
  content: string
  citations?: Citation[]
  renderCitation: (citation: Citation) => React.ReactNode
  streaming?: boolean
  className?: string
}) {
  const components: Components = React.useMemo(
    () => ({
      a: ({ href, children }) => {
        if (href?.startsWith(CITE_HREF)) {
          const n = Number(href.slice(CITE_HREF.length))
          const citation = citations?.find((c) => c.n === n)
          // chips carry their own styling — opt out of typeset
          return citation ? (
            <span data-not-typeset>{renderCitation(citation)}</span>
          ) : null
        }
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      },
      // wide tables scroll inside their own container (typeset-scroll)
      table: ({ children }) => (
        <div className="typeset-scroll">
          <table>{children}</table>
        </div>
      ),
    }),
    [citations, renderCitation]
  )

  return (
    <div
      className={cn(
        "typeset typeset-chat",
        streaming && "streaming-caret",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markCitations(content)}
      </ReactMarkdown>
    </div>
  )
}
