/**
 * DocModel — the typed content model for generated documents. Everything
 * renders from this: the Studio editor, the docx/pdf renderers, and the
 * markdown serialization used for persistence and whole-doc revisions.
 * See docs/DOC_GENERATION.md. Pure types + small helpers, no I/O.
 */

import type { Citation } from "@/lib/types"
import type { CalloutTone } from "@/lib/brand/jacobs"

export interface DocMeta {
  title: string
  /** which skill pack produced it (see lib/docgen/skills.ts) */
  docType: string
  subtitle?: string
  /** free text, e.g. contract/package reference */
  project?: string
  preparedFor?: string
  /** "Rev A" — bumped on accepted edit rounds; set client-side */
  revision: string
  /** ISO date, set client-side — never by the model */
  date: string
}

export type InlineRun =
  | { t: "text"; text: string; bold?: boolean; italic?: boolean }
  /** reference into DocModel.citations by citation number */
  | { t: "cite"; n: number }

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; id: string }
  | { kind: "paragraph"; runs: InlineRun[]; id: string }
  | { kind: "bullets" | "numbered"; items: InlineRun[][]; id: string }
  | {
      kind: "table"
      caption?: string
      header: string[]
      rows: string[][]
      id: string
    }
  | { kind: "callout"; tone: CalloutTone; runs: InlineRun[]; id: string }

export interface DocModel {
  meta: DocMeta
  blocks: Block[]
  citations: Citation[]
  /** non-fatal issues from parsing (e.g. missing envelope) */
  parseWarnings: string[]
}

/** One saved state of an artifact — accepted edit rounds append here. */
export interface DocVersionEntry {
  /** 1-based version number */
  v: number
  /** what changed, one line */
  summary: string
  at: string
  /** full snapshot, serialized envelope markdown (see serializeDocModel) */
  markdown: string
}

let blockCounter = 0

/** Stable client-side block id (never persisted to Foundry). */
export function blockId(): string {
  blockCounter += 1
  return `b${blockCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Plain text of a run list (for summaries, search, docx fallbacks). */
export function runsToText(runs: InlineRun[], citations?: Citation[]): string {
  return runs
    .map((r) => {
      if (r.t === "text") return r.text
      const cite = citations?.find((c) => c.n === r.n)
      return cite ? `[${r.n}]` : ""
    })
    .join("")
}

/** Section = a heading block plus everything until the next same-or-higher heading. */
export function sectionBlockIds(model: DocModel, headingId: string): string[] {
  const start = model.blocks.findIndex((b) => b.id === headingId)
  if (start === -1) return []
  const startBlock = model.blocks[start]
  if (startBlock.kind !== "heading") return [headingId]
  const ids = [headingId]
  for (let i = start + 1; i < model.blocks.length; i += 1) {
    const block = model.blocks[i]
    if (block.kind === "heading" && block.level <= startBlock.level) break
    ids.push(block.id)
  }
  return ids
}

/** Citation numbers actually referenced by the given blocks. */
export function citedNumbers(blocks: Block[]): number[] {
  const seen = new Set<number>()
  for (const block of blocks) {
    const runLists =
      block.kind === "paragraph" || block.kind === "callout"
        ? [block.runs]
        : block.kind === "bullets" || block.kind === "numbered"
          ? block.items
          : []
    for (const runs of runLists) {
      for (const run of runs) if (run.t === "cite") seen.add(run.n)
    }
  }
  return [...seen].sort((a, b) => a - b)
}
