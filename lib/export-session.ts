"use client"

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx"
import { jsPDF } from "jspdf"

import { activePath } from "@/lib/store"
import type { ChatMessage, ChatSession } from "@/lib/types"

/**
 * Real transcript export — markdown, Word (docx) and PDF (jspdf), generated
 * client-side from the active conversation path with an optional citations
 * appendix and reasoning traces.
 */

export interface ExportOptions {
  includeCitations: boolean
  includeThinking: boolean
}

interface Turn {
  role: "You" | "Orbit Docs"
  content: string
  thinking: string[]
  citations: { n: number; label: string; pages: string }[]
}

function cleanContent(message: ChatMessage): string {
  return message.content
    .replace(/⟦(\d+)⟧/g, (_, n) => `[${n}]`)
    .replace(/\r\n/g, "\n")
    .trim()
}

function buildTurns(session: ChatSession, options: ExportOptions): Turn[] {
  return activePath(session)
    .filter((m) => m.content.trim())
    .map((m) => ({
      role: m.role === "user" ? ("You" as const) : ("Orbit Docs" as const),
      content: cleanContent(m),
      thinking:
        options.includeThinking && m.role === "assistant"
          ? (m.thinking ?? []).map((t) =>
              t.detail ? `${t.label} — ${t.detail}` : t.label
            )
          : [],
      citations: options.includeCitations
        ? (m.citations ?? []).map((c) => ({
            n: c.n,
            label: c.docName || c.quote || `Source ${c.n}`,
            pages: c.pagesLabel || (c.page ? String(c.page) : ""),
          }))
        : [],
    }))
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

export function exportMarkdown(session: ChatSession, options: ExportOptions): Blob {
  const lines: string[] = [`# ${session.title}`, ""]
  for (const turn of buildTurns(session, options)) {
    lines.push(`## ${turn.role}`, "", turn.content, "")
    if (turn.thinking.length > 0) {
      lines.push("> Reasoning:", ...turn.thinking.map((t) => `> - ${t}`), "")
    }
    if (turn.citations.length > 0) {
      lines.push(
        "**Sources**",
        ...turn.citations.map(
          (c) => `- [${c.n}] ${c.label}${c.pages ? ` — p. ${c.pages}` : ""}`
        ),
        ""
      )
    }
  }
  lines.push("---", `Exported from Orbit Docs · ${new Date().toISOString()}`)
  return new Blob([lines.join("\n")], { type: "text/markdown" })
}

/* ------------------------------------------------------------------ */
/* Word                                                                */
/* ------------------------------------------------------------------ */

function markdownishToParagraphs(text: string): Paragraph[] {
  return text.split("\n").map((line) => {
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      return new Paragraph({
        text: heading[2],
        heading:
          heading[1].length <= 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
      })
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (bullet) {
      return new Paragraph({
        children: runsFromInline(bullet[1]),
        bullet: { level: 0 },
      })
    }
    return new Paragraph({ children: runsFromInline(line) })
  })
}

/** Minimal inline markdown: **bold** only (keeps the generator predictable). */
function runsFromInline(line: string): TextRun[] {
  const runs: TextRun[] = []
  const parts = line.split(/(\*\*[^*]+\*\*)/g)
  for (const part of parts) {
    if (!part) continue
    const bold = part.match(/^\*\*([^*]+)\*\*$/)
    runs.push(new TextRun({ text: bold ? bold[1] : part, bold: Boolean(bold) }))
  }
  return runs.length > 0 ? runs : [new TextRun("")]
}

export async function exportDocx(
  session: ChatSession,
  options: ExportOptions
): Promise<Blob> {
  const children: Paragraph[] = [
    new Paragraph({ text: session.title, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Exported from Orbit Docs · ${new Date().toLocaleString()}`,
          italics: true,
          size: 18,
        }),
      ],
      alignment: AlignmentType.LEFT,
    }),
    new Paragraph(""),
  ]
  for (const turn of buildTurns(session, options)) {
    children.push(
      new Paragraph({ text: turn.role, heading: HeadingLevel.HEADING_2 }),
      ...markdownishToParagraphs(turn.content)
    )
    if (turn.thinking.length > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "Reasoning", bold: true, size: 20 })],
        }),
        ...turn.thinking.map(
          (t) => new Paragraph({ children: [new TextRun({ text: t, italics: true })], bullet: { level: 0 } })
        )
      )
    }
    if (turn.citations.length > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "Sources", bold: true, size: 20 })],
        }),
        ...turn.citations.map(
          (c) =>
            new Paragraph({
              children: [
                new TextRun(
                  `[${c.n}] ${c.label}${c.pages ? ` — p. ${c.pages}` : ""}`
                ),
              ],
              bullet: { level: 0 },
            })
        )
      )
    }
    children.push(new Paragraph(""))
  }
  const doc = new Document({ sections: [{ children }] })
  return Packer.toBlob(doc)
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

export function exportPdf(session: ChatSession, options: ExportOptions): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" })
  const margin = 56
  const pageWidth = doc.internal.pageSize.getWidth() - margin * 2
  const pageHeight = doc.internal.pageSize.getHeight() - margin
  let y = margin

  const ensureRoom = (needed: number) => {
    if (y + needed > pageHeight) {
      doc.addPage()
      y = margin
    }
  }
  const writeLines = (
    text: string,
    { size = 10, style = "normal", gap = 4 }: { size?: number; style?: string; gap?: number } = {}
  ) => {
    doc.setFontSize(size)
    doc.setFont("helvetica", style)
    for (const paragraph of text.split("\n")) {
      const lines: string[] = doc.splitTextToSize(paragraph || " ", pageWidth)
      for (const line of lines) {
        ensureRoom(size + 4)
        doc.text(line, margin, y)
        y += size + 3
      }
      y += gap
    }
  }

  writeLines(session.title, { size: 18, style: "bold", gap: 8 })
  writeLines(`Exported from Orbit Docs · ${new Date().toLocaleString()}`, {
    size: 8,
    style: "italic",
    gap: 12,
  })

  for (const turn of buildTurns(session, options)) {
    ensureRoom(30)
    writeLines(turn.role, { size: 12, style: "bold", gap: 4 })
    // strip markdown markers for the PDF text flow
    const plain = turn.content
      .replace(/^#{1,4}\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
    writeLines(plain, { size: 10, gap: 6 })
    if (turn.thinking.length > 0) {
      writeLines("Reasoning", { size: 9, style: "bold", gap: 2 })
      writeLines(turn.thinking.map((t) => `• ${t}`).join("\n"), {
        size: 8,
        style: "italic",
        gap: 6,
      })
    }
    if (turn.citations.length > 0) {
      writeLines("Sources", { size: 9, style: "bold", gap: 2 })
      writeLines(
        turn.citations
          .map((c) => `[${c.n}] ${c.label}${c.pages ? ` — p. ${c.pages}` : ""}`)
          .join("\n"),
        { size: 8, gap: 8 }
      )
    }
  }
  return doc.output("blob")
}

/* ------------------------------------------------------------------ */

export async function generateSessionExport(
  session: ChatSession,
  format: "pdf" | "markdown" | "docx",
  options: ExportOptions
): Promise<Blob> {
  if (format === "markdown") return exportMarkdown(session, options)
  if (format === "docx") return exportDocx(session, options)
  return exportPdf(session, options)
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
