import { jsPDF } from "jspdf"
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
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

/** Strip markdown decorations for the PDF/Word renderers. */
function plainBlocks(text: string): { kind: "p" | "li" | "quote"; text: string }[] {
  const blocks: { kind: "p" | "li" | "quote"; text: string }[] = []
  for (const block of text.split(/\n\n+/).filter(Boolean)) {
    const lines = block.split("\n")
    if (lines.every((l) => l.startsWith("- "))) {
      for (const line of lines) {
        blocks.push({ kind: "li", text: line.slice(2).replace(/\*\*/g, "") })
      }
    } else if (block.startsWith("> ")) {
      blocks.push({ kind: "quote", text: block.slice(2).replace(/\*\*/g, "") })
    } else {
      blocks.push({ kind: "p", text: block.replace(/\*\*/g, "") })
    }
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

  pdf.setTextColor(29, 78, 216)
  writeLines("JACOBS · ORBIT DOCS", 8, "bold", 0, 2)
  pdf.setTextColor(15, 23, 42)
  writeLines(sessionTitle, 16, "bold", 0, 14)

  for (const block of plainBlocks(bodyText(message, includeRefs))) {
    if (block.kind === "li") writeLines(`•  ${block.text}`, 10.5, "normal", 12, 4)
    else if (block.kind === "quote") writeLines(block.text, 10.5, "italic", 12, 8)
    else writeLines(block.text, 10.5, "normal", 0, 8)
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
  const children: Paragraph[] = [
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

  for (const block of plainBlocks(bodyText(message, includeRefs))) {
    if (block.kind === "li") {
      children.push(
        new Paragraph({ text: block.text, bullet: { level: 0 }, spacing: { after: 80 } })
      )
    } else if (block.kind === "quote") {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: block.text, italics: true })],
          indent: { left: 360 },
          spacing: { after: 160 },
        })
      )
    } else {
      children.push(new Paragraph({ text: block.text, spacing: { after: 160 } }))
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
