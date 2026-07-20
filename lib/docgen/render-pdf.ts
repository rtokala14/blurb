"use client"

import { jsPDF } from "jspdf"

import {
  brandHex,
  BRAND_DISCLAIMER,
  BRAND_TYPE,
  BRAND_WORDMARK,
  CALLOUT_TONES,
} from "@/lib/brand/jacobs"
import type { Citation } from "@/lib/types"
import { citedNumbers, runsToText, type Block, type DocModel } from "./model"

/**
 * DocModel → branded PDF via jspdf. Same brand source as the docx renderer;
 * headers/footers are stamped on every content page in a second pass so
 * "Page X of Y" is correct.
 */

const MARGIN = 56
const FONT = BRAND_TYPE.pdfFont

interface Flow {
  doc: jsPDF
  y: number
  pageWidth: number
  pageHeight: number
}

function ensureRoom(flow: Flow, needed: number) {
  if (flow.y + needed > flow.pageHeight - MARGIN - 26) {
    flow.doc.addPage()
    flow.y = MARGIN + 20
  }
}

function writeWrapped(
  flow: Flow,
  text: string,
  {
    size = BRAND_TYPE.body,
    style = "normal",
    color = brandHex("ink"),
    gap = BRAND_TYPE.paragraphSpacing,
    indent = 0,
  }: { size?: number; style?: string; color?: string; gap?: number; indent?: number } = {}
) {
  const { doc } = flow
  doc.setFont(FONT, style)
  doc.setFontSize(size)
  doc.setTextColor(color)
  const width = flow.pageWidth - MARGIN * 2 - indent
  const lines: string[] = doc.splitTextToSize(text || " ", width)
  for (const line of lines) {
    ensureRoom(flow, size + 4)
    doc.text(line, MARGIN + indent, flow.y)
    flow.y += size * BRAND_TYPE.lineHeight + 2
  }
  flow.y += gap
}

function drawTable(flow: Flow, block: Extract<Block, { kind: "table" }>) {
  const { doc } = flow
  const cols = Math.max(block.header.length, 1)
  const tableWidth = flow.pageWidth - MARGIN * 2
  const colWidth = tableWidth / cols
  const cellPad = 5
  const fontSize = BRAND_TYPE.caption + 0.5

  const rowLines = (cells: string[]) =>
    cells.map((cell) =>
      doc.splitTextToSize(cell || " ", colWidth - cellPad * 2)
    ) as string[][]

  const drawRow = (
    cells: string[],
    opts: { header?: boolean; zebra?: boolean }
  ) => {
    doc.setFont(FONT, opts.header ? "bold" : "normal")
    doc.setFontSize(fontSize)
    const wrapped = rowLines(cells)
    const lineCount = Math.max(...wrapped.map((w) => w.length), 1)
    const rowHeight = lineCount * (fontSize + 2.5) + cellPad * 2
    ensureRoom(flow, rowHeight)
    // fill
    if (opts.header) {
      doc.setFillColor(brandHex("primary"))
      doc.rect(MARGIN, flow.y, tableWidth, rowHeight, "F")
    } else if (opts.zebra) {
      doc.setFillColor(brandHex("primaryTint"))
      doc.rect(MARGIN, flow.y, tableWidth, rowHeight, "F")
    }
    // borders
    doc.setDrawColor(brandHex("hairline"))
    doc.setLineWidth(0.6)
    doc.rect(MARGIN, flow.y, tableWidth, rowHeight, "S")
    for (let c = 1; c < cols; c += 1) {
      doc.line(MARGIN + colWidth * c, flow.y, MARGIN + colWidth * c, flow.y + rowHeight)
    }
    // text
    doc.setTextColor(opts.header ? brandHex("onPrimary") : brandHex("ink"))
    wrapped.forEach((linesInCell, c) => {
      linesInCell.forEach((line, l) => {
        doc.text(
          line,
          MARGIN + colWidth * c + cellPad,
          flow.y + cellPad + (l + 0.8) * (fontSize + 2.5) - 2
        )
      })
    })
    flow.y += rowHeight
  }

  drawRow(block.header, { header: true })
  block.rows.forEach((row, r) => drawRow(row, { zebra: r % 2 === 1 }))
  flow.y += BRAND_TYPE.paragraphSpacing + 2
}

function drawCallout(
  flow: Flow,
  block: Extract<Block, { kind: "callout" }>,
  citations: Citation[]
) {
  const { doc } = flow
  const tone = CALLOUT_TONES[block.tone]
  const text = `${tone.label}: ${textWithCites(block.runs, citations)}`
  const width = flow.pageWidth - MARGIN * 2 - 14
  doc.setFont(FONT, "normal")
  doc.setFontSize(BRAND_TYPE.body)
  const lines: string[] = doc.splitTextToSize(text, width)
  const height = lines.length * (BRAND_TYPE.body * BRAND_TYPE.lineHeight + 2) + 10
  ensureRoom(flow, height)
  doc.setFillColor(brandHex("primaryTint"))
  doc.rect(MARGIN, flow.y - 4, flow.pageWidth - MARGIN * 2, height, "F")
  doc.setFillColor(`#${tone.edge}`)
  doc.rect(MARGIN, flow.y - 4, 3, height, "F")
  doc.setTextColor(brandHex("ink"))
  let textY = flow.y + 6
  for (const line of lines) {
    doc.text(line, MARGIN + 10, textY)
    textY += BRAND_TYPE.body * BRAND_TYPE.lineHeight + 2
  }
  flow.y += height + BRAND_TYPE.paragraphSpacing
}

function textWithCites(runs: Parameters<typeof runsToText>[0], citations: Citation[]) {
  return runs
    .map((r) => (r.t === "text" ? r.text : citations.some((c) => c.n === r.n) ? ` [${r.n}]` : ""))
    .join("")
    .replace(/\s+\[/g, " [")
}

function drawCover(flow: Flow, model: DocModel) {
  const { doc } = flow
  const meta = model.meta
  // wordmark
  doc.setFont(FONT, "bold")
  doc.setFontSize(BRAND_TYPE.h2)
  doc.setTextColor(brandHex("primary"))
  doc.text(BRAND_WORDMARK.primary, MARGIN, MARGIN + 8)
  const w = doc.getTextWidth(BRAND_WORDMARK.primary)
  doc.setFont(FONT, "normal")
  doc.setFontSize(BRAND_TYPE.h3)
  doc.setTextColor(brandHex("inkMuted"))
  doc.text(`  ·  ${BRAND_WORDMARK.secondary}`, MARGIN + w, MARGIN + 8)
  // primary band
  doc.setFillColor(brandHex("primary"))
  doc.rect(0, 190, flow.pageWidth, 8, "F")
  // title
  doc.setFont(FONT, "bold")
  doc.setFontSize(BRAND_TYPE.coverTitle)
  doc.setTextColor(brandHex("primary"))
  const titleLines: string[] = doc.splitTextToSize(meta.title, flow.pageWidth - MARGIN * 2)
  let y = 240
  for (const line of titleLines) {
    doc.text(line, MARGIN, y)
    y += BRAND_TYPE.coverTitle + 6
  }
  if (meta.subtitle) {
    doc.setFont(FONT, "normal")
    doc.setFontSize(BRAND_TYPE.coverSubtitle)
    doc.setTextColor(brandHex("inkMuted"))
    for (const line of doc.splitTextToSize(meta.subtitle, flow.pageWidth - MARGIN * 2) as string[]) {
      doc.text(line, MARGIN, y)
      y += BRAND_TYPE.coverSubtitle + 4
    }
  }
  y += 40
  const metaLine = (label: string, value?: string) => {
    if (!value) return
    doc.setFont(FONT, "bold")
    doc.setFontSize(BRAND_TYPE.body)
    doc.setTextColor(brandHex("inkMuted"))
    doc.text(`${label}:`, MARGIN, y)
    doc.setFont(FONT, "normal")
    doc.setTextColor(brandHex("ink"))
    doc.text(value, MARGIN + 90, y)
    y += BRAND_TYPE.body + 8
  }
  metaLine("Project", meta.project)
  metaLine("Prepared for", meta.preparedFor)
  metaLine("Date", meta.date)
  metaLine("Revision", meta.revision)
  // disclaimer on the cover
  doc.setFont(FONT, "italic")
  doc.setFontSize(BRAND_TYPE.footer)
  doc.setTextColor(brandHex("inkMuted"))
  doc.text(BRAND_DISCLAIMER, MARGIN, flow.pageHeight - 30)
}

/** Running header/footer for content pages (2..N), stamped in a second pass. */
function stampChrome(doc: jsPDF, model: DocModel, pageWidth: number, pageHeight: number) {
  const total = doc.getNumberOfPages()
  for (let p = 2; p <= total; p += 1) {
    doc.setPage(p)
    // header
    doc.setFont(FONT, "normal")
    doc.setFontSize(BRAND_TYPE.caption)
    doc.setTextColor(brandHex("inkMuted"))
    doc.text(model.meta.title, MARGIN, MARGIN - 24)
    const right = model.meta.project ?? BRAND_WORDMARK.primary
    doc.text(right, pageWidth - MARGIN - doc.getTextWidth(right), MARGIN - 24)
    doc.setDrawColor(brandHex("hairline"))
    doc.setLineWidth(0.6)
    doc.line(MARGIN, MARGIN - 18, pageWidth - MARGIN, MARGIN - 18)
    // footer
    doc.line(MARGIN, pageHeight - 40, pageWidth - MARGIN, pageHeight - 40)
    doc.setFontSize(BRAND_TYPE.footer)
    doc.text(`${model.meta.revision} · ${model.meta.date}`, MARGIN, pageHeight - 30)
    const pageLabel = `Page ${p - 1} of ${total - 1}`
    doc.text(pageLabel, pageWidth - MARGIN - doc.getTextWidth(pageLabel), pageHeight - 30)
    doc.setFont(FONT, "italic")
    doc.text(BRAND_DISCLAIMER, MARGIN, pageHeight - 20)
    doc.setFont(FONT, "normal")
  }
}

export function renderPdf(model: DocModel): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const flow: Flow = { doc, y: MARGIN + 20, pageWidth, pageHeight }

  drawCover(flow, model)
  doc.addPage()
  flow.y = MARGIN + 20

  for (const block of model.blocks) {
    switch (block.kind) {
      case "heading": {
        const size =
          block.level === 1 ? BRAND_TYPE.h1 : block.level === 2 ? BRAND_TYPE.h2 : BRAND_TYPE.h3
        ensureRoom(flow, size + 24)
        flow.y += block.level === 1 ? 10 : 6
        writeWrapped(flow, block.text, {
          size,
          style: "bold",
          color: brandHex("primary"),
          gap: 4,
        })
        break
      }
      case "paragraph":
        writeWrapped(flow, textWithCites(block.runs, model.citations))
        break
      case "bullets":
      case "numbered":
        block.items.forEach((item, i) => {
          const marker = block.kind === "bullets" ? "•" : `${i + 1}.`
          writeWrapped(flow, `${marker}  ${textWithCites(item, model.citations)}`, {
            gap: 2,
            indent: 10,
          })
        })
        flow.y += 4
        break
      case "table":
        drawTable(flow, block)
        break
      case "callout":
        drawCallout(flow, block, model.citations)
        break
    }
  }

  // References
  const used = new Set(citedNumbers(model.blocks))
  const cited = model.citations.filter((c) => used.has(c.n))
  const list = cited.length > 0 ? cited : model.citations
  if (list.length > 0) {
    flow.y += 12
    writeWrapped(flow, "References", {
      size: BRAND_TYPE.h2,
      style: "bold",
      color: brandHex("primary"),
      gap: 4,
    })
    for (const c of list) {
      writeWrapped(
        flow,
        `[${c.n}] ${c.docName || "Source document"}${
          c.pagesLabel ? ` — p. ${c.pagesLabel}` : c.page ? ` — p. ${c.page}` : ""
        }`,
        { size: BRAND_TYPE.caption, color: brandHex("inkMuted"), gap: 2 }
      )
    }
  }

  stampChrome(doc, model, pageWidth, pageHeight)
  return doc.output("blob")
}
