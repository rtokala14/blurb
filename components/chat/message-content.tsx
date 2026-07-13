"use client"

import * as React from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"
import type { Citation } from "@/lib/types"

/**
 * Full GFM markdown renderer for chat messages (headings, lists, tables,
 * code, quotes, links), styled with the app's design tokens. Inline
 * citation markers ⟦n⟧ are rewritten to `#cite-n` links and rendered as
 * citation chips via `renderCitation`.
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
          return citation ? <>{renderCitation(citation)}</> : null
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {children}
          </a>
        )
      },
      p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
      em: ({ children }) => <em className="font-medium not-italic">{children}</em>,
      h1: ({ children }) => (
        <h3 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h3>
      ),
      h2: ({ children }) => (
        <h4 className="mt-4 mb-1.5 text-sm font-semibold first:mt-0">{children}</h4>
      ),
      h3: ({ children }) => (
        <h5 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h5>
      ),
      h4: ({ children }) => (
        <h6 className="mt-3 mb-1 text-sm font-medium first:mt-0">{children}</h6>
      ),
      ul: ({ children }) => (
        <ul className="mb-3 ml-5 list-disc space-y-1 last:mb-0">{children}</ul>
      ),
      ol: ({ children }) => (
        <ol className="mb-3 ml-5 list-decimal space-y-1 last:mb-0">{children}</ol>
      ),
      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
      blockquote: ({ children }) => (
        <blockquote className="border-primary/30 text-muted-foreground mb-3 border-l-2 pl-3 last:mb-0">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="border-border my-3" />,
      table: ({ children }) => (
        <div className="mb-3 overflow-x-auto rounded-md border last:mb-0">
          <table className="w-full text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }) => (
        <thead className="bg-muted/60">{children}</thead>
      ),
      tr: ({ children }) => <tr className="border-t first:border-t-0">{children}</tr>,
      th: ({ children }) => (
        <th className="px-2.5 py-1.5 text-left text-xs font-semibold">{children}</th>
      ),
      td: ({ children }) => (
        <td className="px-2.5 py-1.5 align-top text-xs">{children}</td>
      ),
      code: ({ children, className: codeClass }) => {
        // block code arrives with a language class; inline code without
        const isBlock = Boolean(codeClass)
        if (isBlock) return <code className={codeClass}>{children}</code>
        return (
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">
            {children}
          </code>
        )
      },
      pre: ({ children }) => (
        <pre className="bg-muted mb-3 overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed last:mb-0">
          {children}
        </pre>
      ),
    }),
    [citations, renderCitation]
  )

  return (
    <div
      className={cn(
        "text-sm leading-relaxed",
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
