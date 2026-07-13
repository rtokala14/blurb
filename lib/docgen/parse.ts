/**
 * Envelope parser: agent output → DocModel, and DocModel → envelope markdown.
 *
 * The generation prompt asks the agent for:
 *
 *   ```orbit-doc
 *   {"title": "...", "docType": "technical-memo", "subtitle": "...", ...}
 *   ```
 *   # 1. Purpose
 *   Body markdown with <source …>…</source> citations, GFM tables, and
 *   > [!note|risk|action] callouts.
 *
 * Fallback is mandatory: malformed or missing envelope parses as plain
 * markdown into a valid DocModel — generation never loses content. Pure,
 * unit-tested; shared by client (streaming render) and any server use.
 */

import { parseLiveMessage } from "@/lib/live-citations"
import { liveCitationToUi } from "@/lib/live-map"
import type { Citation } from "@/lib/types"
import {
  blockId,
  type Block,
  type DocMeta,
  type DocModel,
  type InlineRun,
} from "./model"

const ENVELOPE_RE = /```orbit-doc\s*\n([\s\S]*?)```/
const CITE_MARKER_RE = /⟦(\d+)⟧/g

export interface ParseDocOptions {
  /** used when the envelope carries no title and the body has no heading */
  fallbackTitle?: string
  /** default docType when the envelope is missing/invalid */
  fallbackDocType?: string
}

/* ------------------------------------------------------------------ */
/* Inline runs                                                          */
/* ------------------------------------------------------------------ */

/** Minimal inline markdown: **bold**, *italic*, ⟦n⟧ citation markers. */
export function parseInlineRuns(text: string): InlineRun[] {
  const runs: InlineRun[] = []
  const push = (piece: string, bold: boolean, italic: boolean) => {
    if (!piece) return
    let last = 0
    for (const match of piece.matchAll(CITE_MARKER_RE)) {
      const before = piece.slice(last, match.index)
      if (before) runs.push({ t: "text", text: before, ...(bold && { bold }), ...(italic && { italic }) })
      runs.push({ t: "cite", n: Number(match[1]) })
      last = (match.index ?? 0) + match[0].length
    }
    const rest = piece.slice(last)
    if (rest) runs.push({ t: "text", text: rest, ...(bold && { bold }), ...(italic && { italic }) })
  }

  // Split on bold first, then italic inside the non-bold pieces.
  for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue
    const bold = part.match(/^\*\*([^*]+)\*\*$/)
    if (bold) {
      push(bold[1], true, false)
      continue
    }
    for (const sub of part.split(/(\*[^*\s][^*]*\*)/g)) {
      if (!sub) continue
      const italic = sub.match(/^\*([^*]+)\*$/)
      if (italic) push(italic[1], false, true)
      else push(sub, false, false)
    }
  }
  return runs.length > 0 ? runs : [{ t: "text", text: "" }]
}

/* ------------------------------------------------------------------ */
/* Meta                                                                 */
/* ------------------------------------------------------------------ */

const META_STRING_KEYS = [
  "title",
  "docType",
  "subtitle",
  "project",
  "preparedFor",
  "revision",
  "date",
] as const

function parseMeta(
  jsonText: string,
  warnings: string[]
): Partial<DocMeta> {
  try {
    const raw = JSON.parse(jsonText) as Record<string, unknown>
    const meta: Partial<DocMeta> = {}
    for (const key of META_STRING_KEYS) {
      const value = raw[key]
      if (typeof value === "string" && value.trim()) {
        meta[key] = value.trim()
      }
    }
    return meta
  } catch {
    warnings.push("Document header was malformed — imported the draft loosely.")
    return {}
  }
}

/* ------------------------------------------------------------------ */
/* Body → blocks                                                        */
/* ------------------------------------------------------------------ */

const TABLE_DIVIDER_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/
const CALLOUT_RE = /^>\s*\[!(note|risk|action)\]\s*(.*)$/i

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim())
}

/** Strip markdown emphasis + cite markers for plain table cells / headings. */
function plainText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim()
}

export function parseBlocks(body: string): Block[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n")
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { kind: "bullets" | "numbered"; items: string[] } | null = null
  let callout: { tone: "note" | "risk" | "action"; lines: string[] } | null = null

  const flushParagraph = () => {
    const text = paragraph.join(" ").replace(/\s+/g, " ").trim()
    paragraph = []
    if (text) blocks.push({ kind: "paragraph", runs: parseInlineRuns(text), id: blockId() })
  }
  const flushList = () => {
    if (!list) return
    blocks.push({
      kind: list.kind,
      items: list.items.map((item) => parseInlineRuns(item)),
      id: blockId(),
    })
    list = null
  }
  const flushCallout = () => {
    if (!callout) return
    const text = callout.lines.join(" ").replace(/\s+/g, " ").trim()
    if (text) {
      blocks.push({
        kind: "callout",
        tone: callout.tone,
        runs: parseInlineRuns(text),
        id: blockId(),
      })
    }
    callout = null
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushCallout()
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()

    // blank line ends any open block — except a list the next non-blank
    // line continues (agents often blank-separate numbered items)
    if (!trimmed) {
      flushParagraph()
      flushCallout()
      if (list) {
        let j = i + 1
        while (j < lines.length && !lines[j].trim()) j += 1
        const next = lines[j]?.trim() ?? ""
        const continues =
          list.kind === "bullets" ? /^[-*]\s+/.test(next) : /^\d+[.)]\s+/.test(next)
        if (!continues) flushList()
      }
      continue
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      flushAll()
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: plainText(heading[2]),
        id: blockId(),
      })
      continue
    }

    // GFM table: header row + divider row
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      TABLE_DIVIDER_RE.test(lines[i + 1])
    ) {
      flushAll()
      const header = splitTableRow(trimmed).map(plainText)
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && lines[j].includes("|") && lines[j].trim()) {
        const cells = splitTableRow(lines[j]).map(plainText)
        // normalize ragged rows to the header width
        rows.push(header.map((_, c) => cells[c] ?? ""))
        j += 1
      }
      blocks.push({ kind: "table", header, rows, id: blockId() })
      i = j - 1
      continue
    }

    const calloutStart = trimmed.match(CALLOUT_RE)
    if (calloutStart) {
      flushAll()
      callout = {
        tone: calloutStart[1].toLowerCase() as "note" | "risk" | "action",
        lines: calloutStart[2] ? [calloutStart[2]] : [],
      }
      continue
    }
    if (callout && trimmed.startsWith(">")) {
      callout.lines.push(trimmed.replace(/^>\s?/, ""))
      continue
    }
    flushCallout()

    const bullet = trimmed.match(/^[-*]\s+(.*)$/)
    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      flushParagraph()
      const kind = bullet ? "bullets" : "numbered"
      if (!list || list.kind !== kind) {
        flushList()
        list = { kind, items: [] }
      }
      list.items.push((bullet ?? numbered)![1])
      continue
    }
    flushList()

    // plain blockquote without a callout tag → treat as a note callout body
    if (trimmed.startsWith(">")) {
      paragraph.push(trimmed.replace(/^>\s?/, ""))
      continue
    }

    paragraph.push(trimmed)
  }
  flushAll()
  return blocks
}

/* ------------------------------------------------------------------ */
/* Full parse                                                           */
/* ------------------------------------------------------------------ */

/**
 * Agents sometimes narrate before the document proper ("Let me compile the
 * findings. Final Answer:"). When the body is heading-structured, drop
 * leading paragraphs that read as chatter — never legitimate content.
 */
const CHATTER_RE =
  /^(final answer\b|i (now|will|'ll|have|am)\b|let me\b|here (is|'s)\b|below is\b|now (i|let)\b|sure[,.! ]|okay[,.! ]|certainly\b|based on (my|the) (review|analysis), i\b)/i

function stripLeadingChatter(blocks: Block[]): void {
  const hasHeadings = blocks.some((b) => b.kind === "heading")
  if (!hasHeadings) return
  while (blocks.length > 0 && blocks[0].kind === "paragraph") {
    const text = blocks[0].runs
      .map((r) => (r.t === "text" ? r.text : ""))
      .join("")
      .trim()
    if (!CHATTER_RE.test(text)) break
    blocks.shift()
  }
}

/**
 * Parse already-marked content (source tags → ⟦n⟧ done upstream, e.g. by
 * the transcript mapper) plus its citations array into a DocModel. This is
 * how persisted chat messages become artifacts again on reload.
 */
export function parseDocFromMarked(
  marked: string,
  citations: Citation[],
  options: ParseDocOptions = {}
): DocModel {
  const warnings: string[] = []
  let body = marked

  const envelope = marked.match(ENVELOPE_RE)
  let meta: Partial<DocMeta> = {}
  if (envelope) {
    meta = parseMeta(envelope[1], warnings)
    body = marked.replace(ENVELOPE_RE, "")
  } else if (marked.trim()) {
    warnings.push("No document header found — imported the draft loosely.")
  }

  const blocks = parseBlocks(body)
  stripLeadingChatter(blocks)

  // Title precedence: envelope → first level-1/2 heading → fallback.
  let title = meta.title
  if (!title) {
    const firstHeading = blocks.find(
      (b): b is Extract<Block, { kind: "heading" }> => b.kind === "heading"
    )
    title = firstHeading?.text || options.fallbackTitle || "Untitled document"
  }
  // If the envelope already names the document, drop a duplicate H1.
  if (meta.title && blocks[0]?.kind === "heading" && blocks[0].level === 1) {
    if (plainText(blocks[0].text).toLowerCase() === meta.title.toLowerCase()) {
      blocks.shift()
    }
  }

  return {
    meta: {
      title,
      docType: meta.docType || options.fallbackDocType || "technical-memo",
      subtitle: meta.subtitle,
      project: meta.project,
      preparedFor: meta.preparedFor,
      revision: meta.revision || "Rev A",
      date: meta.date || new Date().toISOString().slice(0, 10),
    },
    blocks,
    citations,
    parseWarnings: warnings,
  }
}

/** Agent output (raw source tags) → DocModel. */
export function parseDocEnvelope(
  raw: string,
  options: ParseDocOptions = {}
): DocModel {
  // Lift <source> tags into citations; body becomes ⟦n⟧-marked markdown.
  const lifted = parseLiveMessage(raw)
  return parseDocFromMarked(
    lifted.content,
    lifted.citations.map(liveCitationToUi),
    options
  )
}

/**
 * Streaming-safe parse: hides a trailing partial <source…> tag and an
 * unterminated ```orbit-doc fence so nothing flashes as raw text mid-stream.
 */
export function parseStreamingDoc(
  raw: string,
  options: ParseDocOptions = {}
): DocModel {
  let safe = raw
  // Envelope fence still open → hold back everything from the fence on.
  const fenceStart = safe.indexOf("```orbit-doc")
  if (fenceStart !== -1 && !ENVELOPE_RE.test(safe)) {
    safe = safe.slice(0, fenceStart)
  }
  // Trailing partial source tag → cut at the opening.
  const lastOpen = safe.lastIndexOf("<source")
  if (lastOpen !== -1 && !safe.slice(lastOpen).includes("</source>")) {
    safe = safe.slice(0, lastOpen)
  }
  return parseDocEnvelope(safe, options)
}

/* ------------------------------------------------------------------ */
/* Serialize (persistence + whole-doc revision round-trip)              */
/* ------------------------------------------------------------------ */

/** How citation runs serialize: agent-format tags, or the UI's ⟦n⟧ markers. */
export type CiteMode = "tags" | "markers"

function runsToMarkdown(
  runs: InlineRun[],
  citations: Citation[],
  cites: CiteMode
): string {
  return runs
    .map((run) => {
      if (run.t === "cite") {
        const cite = citations.find((c) => c.n === run.n)
        if (!cite) return ""
        if (cites === "markers") return `⟦${run.n}⟧`
        const attrs = [
          `id="${cite.mediaRid ?? ""}"`,
          `name="${(cite.docName ?? "").replace(/"/g, "'")}"`,
          ...(cite.quote ? [`text="${cite.quote.replace(/"/g, "'")}"`] : []),
        ].join(" ")
        return `<source ${attrs}>${cite.pagesLabel || cite.page || 0}</source>`
      }
      let text = run.text
      if (run.bold) text = `**${text}**`
      else if (run.italic) text = `*${text}*`
      return text
    })
    .join("")
}

/** Body-only markdown for a block list (section edits, manual editing). */
export function blocksToMarkdown(
  blocks: Block[],
  citations: Citation[],
  cites: CiteMode = "tags"
): string {
  const lines: string[] = []
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        lines.push(`${"#".repeat(block.level)} ${block.text}`, "")
        break
      case "paragraph":
        lines.push(runsToMarkdown(block.runs, citations, cites), "")
        break
      case "bullets":
        for (const item of block.items)
          lines.push(`- ${runsToMarkdown(item, citations, cites)}`)
        lines.push("")
        break
      case "numbered":
        block.items.forEach((item, i) =>
          lines.push(`${i + 1}. ${runsToMarkdown(item, citations, cites)}`)
        )
        lines.push("")
        break
      case "table":
        lines.push(`| ${block.header.join(" | ")} |`)
        lines.push(`| ${block.header.map(() => "---").join(" | ")} |`)
        for (const row of block.rows) lines.push(`| ${row.join(" | ")} |`)
        lines.push("")
        break
      case "callout":
        lines.push(
          `> [!${block.tone}] ${runsToMarkdown(block.runs, citations, cites)}`,
          ""
        )
        break
    }
  }
  return lines.join("\n").trim()
}

/** DocModel → envelope markdown. parse(serialize(m)) preserves content. */
export function serializeDocModel(model: DocModel): string {
  const meta: Record<string, string> = { title: model.meta.title, docType: model.meta.docType }
  for (const key of ["subtitle", "project", "preparedFor", "revision", "date"] as const) {
    const value = model.meta[key]
    if (value) meta[key] = value
  }
  return [
    "```orbit-doc",
    JSON.stringify(meta),
    "```",
    "",
    blocksToMarkdown(model.blocks, model.citations, "tags"),
  ].join("\n")
}

/* ------------------------------------------------------------------ */
/* Fragments (AI section edits)                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse a refine-agent response fragment against an existing citation list.
 * Fragment citations matching an existing (mediaRid, pages) pair reuse its
 * number; genuinely new sources are appended after the current maximum.
 * Returns the fragment's blocks plus the merged full citation list.
 */
export function parseFragment(
  raw: string,
  existing: Citation[]
): { blocks: Block[]; citations: Citation[] } {
  const lifted = parseLiveMessage(raw)
  const merged = [...existing]
  let nextN = existing.reduce((max, c) => Math.max(max, c.n), 0)
  const localToFinal = new Map<number, number>()
  for (const local of lifted.citations) {
    const match = existing.find(
      (c) => c.mediaRid === local.mediaRid && (c.pagesLabel ?? "") === local.pages
    )
    if (match) {
      localToFinal.set(local.n, match.n)
    } else {
      nextN += 1
      localToFinal.set(local.n, nextN)
      merged.push({ ...liveCitationToUi(local), n: nextN })
    }
  }
  const blocks = parseBlocks(lifted.content)
  const remapRuns = (runs: InlineRun[]) =>
    runs.forEach((run) => {
      if (run.t === "cite") run.n = localToFinal.get(run.n) ?? run.n
    })
  for (const block of blocks) {
    if (block.kind === "paragraph" || block.kind === "callout") remapRuns(block.runs)
    if (block.kind === "bullets" || block.kind === "numbered")
      block.items.forEach(remapRuns)
  }
  return { blocks, citations: merged }
}
