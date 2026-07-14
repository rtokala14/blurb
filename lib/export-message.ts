import { jsPDF } from "jspdf"
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx"

import type { ChatMessage, Doc } from "@/lib/types"

export type ExportFormat = "md" | "pdf" | "docx"

interface RefEntry {
  n: number
  name: string
  page: number
  quote: string
}

function collectRefs(message: ChatMessage, docs: Doc[]): RefEntry[] {
  return (message.citations ?? [])
    .map((c) => {
      const doc = docs.find((d) => d.id === c.docId)
      return doc
        ? { n: c.n, name: doc.name, page: c.page, quote: c.quote }
        : null
    })
    .filter((r): r is RefEntry => r !== null)
}

/** Body text with citation markers as [n], or removed entirely. */
function bodyText(message: ChatMessage, includeRefs: boolean): string {
  const withMarkers = message.content.replace(/⟦(\d+)⟧/g, (_, n) => `[${n}]`)
  if (includeRefs) return withMarkers
  return withMarkers.replace(/\s?\[\d+\]/g, "")
}

/* ------------------------------------------------------------------ */
/* Lightweight markdown parsing                                        */
/* ------------------------------------------------------------------ */

/** An inline run of text with its formatting flags. */
export interface InlineRun {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
}

/** A parsed block with a kind, optional heading level, and inline runs. */
export interface MdBlock {
  kind: "p" | "li" | "quote" | "heading" | "table"
  level?: number
  /** ordinal for numbered list items ("1." → "1"); "•" otherwise */
  marker?: string
  runs: InlineRun[]
  /** rows of cells (table only); the first row is the header */
  rows?: InlineRun[][][]
}

/**
 * Parse inline markdown (bold, italic, inline code, and links) into styled
 * runs. Links collapse to their visible text; unmatched markers are treated
 * as literal characters.
 */
export function parseInline(text: string): InlineRun[] {
  // links → visible text (drop the URL, keep the label)
  const linked = text.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
  const runs: InlineRun[] = []
  // Order matters: bold before italic so ** isn't consumed as two *.
  const token =
    /(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = token.exec(linked)) !== null) {
    if (m.index > last) runs.push({ text: linked.slice(last, m.index) })
    const raw = m[0]
    if (raw.startsWith("**") || raw.startsWith("__")) {
      runs.push({ text: raw.slice(2, -2), bold: true })
    } else if (raw.startsWith("`")) {
      runs.push({ text: raw.slice(1, -1), code: true })
    } else {
      runs.push({ text: raw.slice(1, -1), italic: true })
    }
    last = m.index + raw.length
  }
  if (last < linked.length) runs.push({ text: linked.slice(last) })
  return runs.length > 0 ? runs : [{ text: "" }]
}

/** Parse markdown into styled blocks for the PDF/Word renderers. */
export function parseBlocks(text: string): MdBlock[] {
  const blocks: MdBlock[] = []
  for (const block of text.split(/\n\n+/).map((b) => b.trim()).filter(Boolean)) {
    const lines = block.split("\n")

    // Heading (only when the whole block is a single heading line)
    const headingMatch = lines.length === 1 && /^(#{1,6})\s+(.*)$/.exec(lines[0])
    if (headingMatch) {
      blocks.push({
        kind: "heading",
        level: headingMatch[1].length,
        runs: parseInline(headingMatch[2]),
      })
      continue
    }

    // Blockquote
    if (lines.every((l) => l.startsWith(">"))) {
      const inner = lines.map((l) => l.replace(/^>\s?/, "")).join(" ")
      blocks.push({ kind: "quote", runs: parseInline(inner) })
      continue
    }

    // GitHub pipe table: header row, a |---|---| separator, then body rows.
    if (
      lines.length >= 2 &&
      lines[0].includes("|") &&
      /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[1])
    ) {
      const splitRow = (line: string) =>
        line
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map((cell) => parseInline(cell.trim()))
      const rows = [lines[0], ...lines.slice(2)].map(splitRow)
      blocks.push({ kind: "table", runs: [], rows })
      continue
    }

    // Unordered / ordered list
    const isBullet = lines.every((l) => /^[-*+]\s+/.test(l))
    const isNumbered = lines.every((l) => /^\d+\.\s+/.test(l))
    if (isBullet || isNumbered) {
      for (const line of lines) {
        if (isNumbered) {
          const nm = /^(\d+)\.\s+(.*)$/.exec(line)!
          blocks.push({ kind: "li", marker: nm[1], runs: parseInline(nm[2]) })
        } else {
          blocks.push({
            kind: "li",
            marker: "•",
            runs: parseInline(line.replace(/^[-*+]\s+/, "")),
          })
        }
      }
      continue
    }

    // Paragraph (join soft-wrapped lines)
    blocks.push({ kind: "p", runs: parseInline(lines.join(" ")) })
  }
  return blocks
}

function fileName(sessionTitle: string, ext: string): string {
  const slug = sessionTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48)
  return `${slug || "orbit-response"}-response.${ext}`
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

export function messageToMarkdown(
  message: ChatMessage,
  docs: Doc[],
  sessionTitle: string,
  includeRefs: boolean
): string {
  const refs = includeRefs ? collectRefs(message, docs) : []
  let md = `# ${sessionTitle}\n\n`
  md += `> Assistant response from Orbit Docs · Jacobs Engineering Solutions\n\n`
  md += bodyText(message, includeRefs)
  if (refs.length > 0) {
    md += `\n\n---\n\n## References\n\n`
    md += refs
      .map((r) => `${r.n}. **${r.name}**, p. ${r.page} — “${r.quote}”`)
      .join("\n")
    md += "\n"
  }
  return md
}

/* ------------------------------------------------------------------ */
/* PDF (jsPDF)                                                         */
/* ------------------------------------------------------------------ */

function messageToPdf(
  message: ChatMessage,
  docs: Doc[],
  sessionTitle: string,
  includeRefs: boolean
): Blob {
  const pdf = new jsPDF({ unit: "pt", format: "letter" })
  const margin = 56
  const width = pdf.internal.pageSize.getWidth() - margin * 2
  const pageHeight = pdf.internal.pageSize.getHeight()
  let y = margin

  const ensureRoom = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      pdf.addPage()
      y = margin
    }
  }
  const writeLines = (
    text: string,
    size: number,
    style: "normal" | "bold" | "italic",
    indent = 0,
    gapAfter = 10
  ) => {
    pdf.setFont("helvetica", style)
    pdf.setFontSize(size)
    const lines: string[] = pdf.splitTextToSize(text, width - indent)
    for (const line of lines) {
      ensureRoom(size * 1.35)
      pdf.text(line, margin + indent, y)
      y += size * 1.35
    }
    y += gapAfter
  }

  /**
   * Word-wrap a sequence of styled runs, switching the font per run so bold
   * and italic segments render correctly inside a paragraph.
   */
  const writeRuns = (
    runs: InlineRun[],
    size: number,
    baseStyle: "normal" | "bold" | "italic",
    indent = 0,
    gapAfter = 10
  ) => {
    pdf.setFontSize(size)
    const lineHeight = size * 1.35
    const maxX = margin + width
    let x = margin + indent
    ensureRoom(lineHeight)

    const styleFor = (run: InlineRun) => {
      if (run.bold && (run.italic || baseStyle === "italic")) return "bolditalic"
      if (run.bold || baseStyle === "bold") return "bold"
      if (run.italic || baseStyle === "italic") return "italic"
      return "normal"
    }

    for (const run of runs) {
      const font = run.code ? "courier" : "helvetica"
      pdf.setFont(font, styleFor(run))
      // Split on whitespace but keep the spaces so wrapping looks natural.
      const words = run.text.split(/(\s+)/).filter((w) => w.length > 0)
      for (const word of words) {
        const w = pdf.getTextWidth(word)
        if (x + w > maxX && !/^\s+$/.test(word)) {
          x = margin + indent
          y += lineHeight
          ensureRoom(lineHeight)
        }
        pdf.text(word, x, y)
        x += w
      }
    }
    y += lineHeight + gapAfter
    pdf.setFont("helvetica", "normal")
  }

  /** Wrap a cell's runs into physical lines that fit within `cellWidth`. */
  const wrapCell = (
    runs: InlineRun[],
    size: number,
    cellWidth: number
  ): InlineRun[][] => {
    const lines: InlineRun[][] = [[]]
    let lineW = 0
    pdf.setFontSize(size)
    for (const run of runs) {
      const font = run.code ? "courier" : "helvetica"
      const style = run.bold ? "bold" : run.italic ? "italic" : "normal"
      pdf.setFont(font, style)
      for (const word of run.text.split(/(\s+)/).filter((w) => w.length > 0)) {
        const w = pdf.getTextWidth(word)
        if (lineW + w > cellWidth && lineW > 0 && !/^\s+$/.test(word)) {
          lines.push([])
          lineW = 0
        }
        lines[lines.length - 1].push({ ...run, text: word })
        lineW += w
      }
    }
    return lines
  }

  /** Render a markdown table with a shaded header and cell grid. */
  const writeTable = (rows: InlineRun[][][], gapAfter = 12) => {
    if (rows.length === 0) return
    const size = 9.5
    const lineHeight = size * 1.3
    const padX = 5
    const padY = 4
    const cols = Math.max(...rows.map((r) => r.length))
    const colWidth = width / cols
    const cellTextWidth = colWidth - padX * 2

    rows.forEach((row, rowIndex) => {
      const isHeader = rowIndex === 0
      // Pre-wrap every cell to find the tallest, so the row shares one height.
      const wrapped = Array.from({ length: cols }, (_, c) =>
        wrapCell(row[c] ?? [{ text: "" }], size, cellTextWidth)
      )
      const rowLines = Math.max(1, ...wrapped.map((w) => w.length))
      const rowHeight = rowLines * lineHeight + padY * 2

      // A row must not straddle a page break.
      if (y + rowHeight > pageHeight - margin) {
        pdf.addPage()
        y = margin
      }

      if (isHeader) {
        pdf.setFillColor(241, 245, 249)
        pdf.rect(margin, y, width, rowHeight, "F")
      }

      // cell text
      wrapped.forEach((cellLines, c) => {
        const cellX = margin + c * colWidth + padX
        let cellY = y + padY + size
        for (const line of cellLines) {
          let lx = cellX
          for (const run of line) {
            const font = run.code ? "courier" : "helvetica"
            const style =
              isHeader || run.bold
                ? "bold"
                : run.italic
                  ? "italic"
                  : "normal"
            pdf.setFont(font, style)
            pdf.setFontSize(size)
            pdf.text(run.text, lx, cellY)
            lx += pdf.getTextWidth(run.text)
          }
          cellY += lineHeight
        }
      })

      // grid lines
      pdf.setDrawColor(203, 213, 225)
      pdf.setLineWidth(0.5)
      pdf.rect(margin, y, width, rowHeight)
      for (let c = 1; c < cols; c++) {
        pdf.line(margin + c * colWidth, y, margin + c * colWidth, y + rowHeight)
      }
      y += rowHeight
    })
    y += gapAfter
    pdf.setFont("helvetica", "normal")
  }

  pdf.setTextColor(29, 78, 216)
  writeLines("JACOBS · ORBIT DOCS", 8, "bold", 0, 2)
  pdf.setTextColor(15, 23, 42)
  writeLines(sessionTitle, 16, "bold", 0, 14)

  const headingSize = (level: number) =>
    level <= 1 ? 15 : level === 2 ? 13 : level === 3 ? 11.5 : 10.5
  for (const block of parseBlocks(bodyText(message, includeRefs))) {
    if (block.kind === "heading") {
      y += 4
      writeRuns(block.runs, headingSize(block.level ?? 3), "bold", 0, 6)
    } else if (block.kind === "li") {
      const marker = block.marker === "•" ? "•" : `${block.marker}.`
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(10.5)
      ensureRoom(10.5 * 1.35)
      pdf.text(marker, margin + 6, y)
      writeRuns(block.runs, 10.5, "normal", 20, 4)
    } else if (block.kind === "quote") {
      writeRuns(block.runs, 10.5, "italic", 12, 8)
    } else if (block.kind === "table" && block.rows) {
      y += 2
      writeTable(block.rows)
    } else {
      writeRuns(block.runs, 10.5, "normal", 0, 8)
    }
  }

  const refs = includeRefs ? collectRefs(message, docs) : []
  if (refs.length > 0) {
    ensureRoom(40)
    y += 8
    pdf.setDrawColor(226, 232, 240)
    pdf.line(margin, y, margin + width, y)
    y += 20
    writeLines("References", 12, "bold", 0, 6)
    for (const r of refs) {
      writeLines(`[${r.n}]  ${r.name} — page ${r.page}`, 9.5, "bold", 0, 1)
      writeLines(`“${r.quote}”`, 9, "italic", 14, 8)
    }
  }

  return pdf.output("blob")
}

/* ------------------------------------------------------------------ */
/* Word (docx)                                                         */
/* ------------------------------------------------------------------ */

async function messageToDocx(
  message: ChatMessage,
  docs: Doc[],
  sessionTitle: string,
  includeRefs: boolean
): Promise<Blob> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      children: [
        new TextRun({
          text: "JACOBS · ORBIT DOCS",
          bold: true,
          size: 14,
          color: "1D4ED8",
        }),
      ],
      spacing: { after: 60 },
    }),
    new Paragraph({
      text: sessionTitle,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 240 },
    }),
  ]

  const docxRuns = (runs: InlineRun[], baseItalic = false) =>
    runs.map(
      (r) =>
        new TextRun({
          text: r.text,
          bold: r.bold,
          italics: r.italic || baseItalic,
          font: r.code ? "Courier New" : undefined,
        })
    )
  const headingLevel = (level: number) =>
    level <= 1
      ? HeadingLevel.HEADING_1
      : level === 2
        ? HeadingLevel.HEADING_2
        : level === 3
          ? HeadingLevel.HEADING_3
          : HeadingLevel.HEADING_4

  const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" }
  const cellBorders = {
    top: thinBorder,
    bottom: thinBorder,
    left: thinBorder,
    right: thinBorder,
  }
  /** Runs for a table cell; header cells force bold. */
  const cellRuns = (runs: InlineRun[], header: boolean) =>
    (runs.length > 0 ? runs : [{ text: "" }]).map(
      (r) =>
        new TextRun({
          text: r.text,
          bold: header || r.bold,
          italics: r.italic,
          font: r.code ? "Courier New" : undefined,
        })
    )
  const docxTable = (rows: InlineRun[][][]): Table => {
    const cols = Math.max(...rows.map((r) => r.length))
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map((row, rowIndex) => {
        const isHeader = rowIndex === 0
        return new TableRow({
          tableHeader: isHeader,
          children: Array.from({ length: cols }, (_, c) => {
            return new TableCell({
              borders: cellBorders,
              shading: isHeader
                ? { type: ShadingType.CLEAR, color: "auto", fill: "F1F5F9" }
                : undefined,
              margins: { top: 40, bottom: 40, left: 80, right: 80 },
              children: [
                new Paragraph({ children: cellRuns(row[c] ?? [], isHeader) }),
              ],
            })
          }),
        })
      }),
    })
  }

  for (const block of parseBlocks(bodyText(message, includeRefs))) {
    if (block.kind === "heading") {
      children.push(
        new Paragraph({
          children: docxRuns(block.runs),
          heading: headingLevel(block.level ?? 3),
          spacing: { before: 200, after: 120 },
        })
      )
    } else if (block.kind === "li") {
      const isNumbered = block.marker !== "•"
      children.push(
        isNumbered
          ? new Paragraph({
            children: [
              new TextRun({ text: `${block.marker}. ` }),
              ...docxRuns(block.runs),
            ],
            indent: { left: 360 },
            spacing: { after: 80 },
          })
          : new Paragraph({
            children: docxRuns(block.runs),
            bullet: { level: 0 },
            spacing: { after: 80 },
          })
      )
    } else if (block.kind === "quote") {
      children.push(
        new Paragraph({
          children: docxRuns(block.runs, true),
          indent: { left: 360 },
          spacing: { after: 160 },
        })
      )
    } else if (block.kind === "table" && block.rows) {
      children.push(docxTable(block.rows))
    } else {
      children.push(
        new Paragraph({ children: docxRuns(block.runs), spacing: { after: 160 } })
      )
    }
  }

  const refs = includeRefs ? collectRefs(message, docs) : []
  if (refs.length > 0) {
    children.push(
      new Paragraph({
        text: "References",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
      })
    )
    for (const r of refs) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `[${r.n}] `, bold: true }),
            new TextRun({ text: `${r.name} — page ${r.page}`, bold: true }),
          ],
          spacing: { after: 40 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `“${r.quote}”`, italics: true, size: 18 })],
          indent: { left: 360 },
          spacing: { after: 120 },
          alignment: AlignmentType.LEFT,
        })
      )
    }
  }

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBlob(doc)
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function downloadMessage(
  format: ExportFormat,
  message: ChatMessage,
  docs: Doc[],
  sessionTitle: string,
  includeRefs: boolean
): Promise<string> {
  const name = fileName(sessionTitle, format)
  if (format === "md") {
    const md = messageToMarkdown(message, docs, sessionTitle, includeRefs)
    triggerDownload(new Blob([md], { type: "text/markdown;charset=utf-8" }), name)
  } else if (format === "pdf") {
    triggerDownload(messageToPdf(message, docs, sessionTitle, includeRefs), name)
  } else {
    triggerDownload(await messageToDocx(message, docs, sessionTitle, includeRefs), name)
  }
  return name
}
