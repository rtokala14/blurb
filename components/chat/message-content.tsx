"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import type { Citation } from "@/lib/types"

/**
 * Minimal markdown-ish renderer for simulated assistant messages.
 * Supports paragraphs, bullet lists, blockquotes, **bold**, *italic*,
 * and inline citation markers ⟦n⟧ rendered via `renderCitation`.
 */

function renderInline(
  text: string,
  citations: Citation[] | undefined,
  renderCitation: (citation: Citation) => React.ReactNode
): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Tokenize: citations ⟦n⟧, **bold**, *italic*
  const regex = /⟦(\d+)⟧|\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    if (match[1] !== undefined) {
      const n = Number(match[1])
      const citation = citations?.find((c) => c.n === n)
      nodes.push(
        <React.Fragment key={`c-${key++}`}>
          {citation ? renderCitation(citation) : null}
        </React.Fragment>
      )
    } else if (match[2] !== undefined) {
      nodes.push(<strong key={`b-${key++}`}>{match[2]}</strong>)
    } else if (match[3] !== undefined) {
      nodes.push(
        <em key={`i-${key++}`} className="font-medium not-italic">
          {match[3]}
        </em>
      )
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
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
  const blocks = content.split(/\n\n+/).filter(Boolean)

  return (
    <div
      className={cn(
        "space-y-3 text-sm leading-relaxed",
        streaming && "streaming-caret",
        className
      )}
    >
      {blocks.map((block, i) => {
        const lines = block.split("\n")
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i} className="ml-5 list-disc space-y-1.5">
              {lines.map((line, j) => (
                <li key={j}>
                  {renderInline(line.slice(2), citations, renderCitation)}
                </li>
              ))}
            </ul>
          )
        }
        if (block.startsWith("> ")) {
          return (
            <blockquote
              key={i}
              className="border-primary/30 text-muted-foreground border-l-2 pl-3"
            >
              {renderInline(block.slice(2), citations, renderCitation)}
            </blockquote>
          )
        }
        return (
          <p key={i}>{renderInline(block, citations, renderCitation)}</p>
        )
      })}
    </div>
  )
}
