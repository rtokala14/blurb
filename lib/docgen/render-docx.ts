"use client"

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from "docx"

import {
  BRAND_COLORS,
  BRAND_DISCLAIMER,
  BRAND_TYPE,
  BRAND_WORDMARK,
  CALLOUT_TONES,
} from "@/lib/brand/jacobs"
import type { Citation } from "@/lib/types"
import { citedNumbers, type Block, type DocModel, type InlineRun } from "./model"

/**
 * DocModel → branded .docx. Deterministic: every visual decision comes from
 * lib/brand/jacobs.ts (see docs/DOC_GENERATION.md, "content ≠ presentation").
 */

/** docx font sizes are half-points. */
const pt = (points: number) => Math.round(points * 2)

const PAGE_TAB = 9000

function inlineRuns(runs: InlineRun[], citations: Citation[]): TextRun[] {
  const out: TextRun[] = []
  for (const run of runs) {
    if (run.t === "cite") {
      if (!citations.some((c) => c.n === run.n)) continue
      out.push(
        new TextRun({
          text: `[${run.n}]`,
          superScript: true,
          color: BRAND_COLORS.primary,
          size: pt(BRAND_TYPE.caption),
        })
      )
      continue
    }
    out.push(
      new TextRun({
        text: run.text,
        bold: run.bold,
        italics: run.italic,
        size: pt(BRAND_TYPE.body),
        color: BRAND_COLORS.ink,
      })
    )
  }
  return out.length > 0 ? out : [new TextRun("")]
}

const HAIRLINE = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: BRAND_COLORS.hairline,
} as const

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "auto" } as const

function tableBlock(block: Extract<Block, { kind: "table" }>): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: block.header.map(
      (cell) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill: BRAND_COLORS.primary },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: cell,
                  bold: true,
                  color: BRAND_COLORS.onPrimary,
                  size: pt(BRAND_TYPE.body),
                }),
              ],
            }),
          ],
        })
    ),
  })
  const bodyRows = block.rows.map(
    (row, r) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              shading:
                r % 2 === 1
                  ? { type: ShadingType.CLEAR, fill: BRAND_COLORS.primaryTint }
                  : undefined,
              margins: { top: 50, bottom: 50, left: 100, right: 100 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: cell,
                      size: pt(BRAND_TYPE.body),
                      color: BRAND_COLORS.ink,
                    }),
                  ],
                }),
              ],
            })
        ),
      })
  )
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: HAIRLINE,
      bottom: HAIRLINE,
      left: HAIRLINE,
      right: HAIRLINE,
      insideHorizontal: HAIRLINE,
      insideVertical: HAIRLINE,
    },
    rows: [headerRow, ...bodyRows],
  })
}

function calloutBlock(
  block: Extract<Block, { kind: "callout" }>,
  citations: Citation[]
): Paragraph {
  const tone = CALLOUT_TONES[block.tone]
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: BRAND_COLORS.primaryTint },
    border: {
      left: { style: BorderStyle.SINGLE, size: 24, color: tone.edge },
      top: NO_BORDER,
      bottom: NO_BORDER,
      right: NO_BORDER,
    },
    spacing: { before: 120, after: 120 },
    indent: { left: 160 },
    children: [
      new TextRun({
        text: `${tone.label}: `,
        bold: true,
        size: pt(BRAND_TYPE.body),
        color: BRAND_COLORS.ink,
      }),
      ...inlineRuns(block.runs, citations),
    ],
  })
}

function headingParagraph(block: Extract<Block, { kind: "heading" }>): Paragraph {
  const size = block.level === 1 ? BRAND_TYPE.h1 : block.level === 2 ? BRAND_TYPE.h2 : BRAND_TYPE.h3
  return new Paragraph({
    heading:
      block.level === 1
        ? HeadingLevel.HEADING_1
        : block.level === 2
          ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3,
    spacing: { before: block.level === 1 ? 280 : 220, after: 100 },
    children: [
      new TextRun({
        text: block.text,
        bold: true,
        size: pt(size),
        color: BRAND_COLORS.primary,
      }),
    ],
  })
}

function bodyChildren(model: DocModel): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []
  for (const block of model.blocks) {
    switch (block.kind) {
      case "heading":
        children.push(headingParagraph(block))
        break
      case "paragraph":
        children.push(
          new Paragraph({
            spacing: { after: BRAND_TYPE.paragraphSpacing * 20 },
            children: inlineRuns(block.runs, model.citations),
          })
        )
        break
      case "bullets":
      case "numbered":
        block.items.forEach((item, i) =>
          children.push(
            new Paragraph({
              spacing: { after: 40 },
              children:
                block.kind === "numbered"
                  ? [
                      new TextRun({
                        text: `${i + 1}. `,
                        size: pt(BRAND_TYPE.body),
                        color: BRAND_COLORS.ink,
                      }),
                      ...inlineRuns(item, model.citations),
                    ]
                  : inlineRuns(item, model.citations),
              ...(block.kind === "bullets" ? { bullet: { level: 0 } } : {}),
            })
          )
        )
        children.push(new Paragraph({ spacing: { after: 60 }, children: [] }))
        break
      case "table":
        children.push(tableBlock(block))
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
        break
      case "callout":
        children.push(calloutBlock(block, model.citations))
        break
    }
  }
  return children
}

function referencesChildren(model: DocModel): Paragraph[] {
  const used = new Set(citedNumbers(model.blocks))
  const cited = model.citations.filter((c) => used.has(c.n))
  const list = cited.length > 0 ? cited : model.citations
  if (list.length === 0) return []
  return [
    new Paragraph({
      spacing: { before: 320, after: 100 },
      children: [
        new TextRun({
          text: "References",
          bold: true,
          size: pt(BRAND_TYPE.h2),
          color: BRAND_COLORS.primary,
        }),
      ],
    }),
    ...list.map(
      (c) =>
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({
              text: `[${c.n}] ${c.docName || "Source document"}${
                c.pagesLabel ? ` — p. ${c.pagesLabel}` : c.page ? ` — p. ${c.page}` : ""
              }`,
              size: pt(BRAND_TYPE.caption),
              color: BRAND_COLORS.inkMuted,
            }),
          ],
        })
    ),
  ]
}

function coverChildren(model: DocModel): Paragraph[] {
  const meta = model.meta
  const metaLine = (label: string, value?: string) =>
    value
      ? [
          new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({
                text: `${label}:  `,
                bold: true,
                size: pt(BRAND_TYPE.body),
                color: BRAND_COLORS.inkMuted,
              }),
              new TextRun({
                text: value,
                size: pt(BRAND_TYPE.body),
                color: BRAND_COLORS.ink,
              }),
            ],
          }),
        ]
      : []
  return [
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: BRAND_WORDMARK.primary,
          bold: true,
          size: pt(BRAND_TYPE.h2),
          color: BRAND_COLORS.primary,
        }),
        new TextRun({
          text: `  ·  ${BRAND_WORDMARK.secondary}`,
          size: pt(BRAND_TYPE.h3),
          color: BRAND_COLORS.inkMuted,
        }),
      ],
    }),
    // full-width primary band
    new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: BRAND_COLORS.primary },
      spacing: { before: 1600, after: 0 },
      children: [new TextRun({ text: " ", size: pt(6) })],
    }),
    new Paragraph({
      spacing: { before: 300, after: 120 },
      children: [
        new TextRun({
          text: meta.title,
          bold: true,
          size: pt(BRAND_TYPE.coverTitle),
          color: BRAND_COLORS.primary,
        }),
      ],
    }),
    ...(meta.subtitle
      ? [
          new Paragraph({
            spacing: { after: 400 },
            children: [
              new TextRun({
                text: meta.subtitle,
                size: pt(BRAND_TYPE.coverSubtitle),
                color: BRAND_COLORS.inkMuted,
              }),
            ],
          }),
        ]
      : [new Paragraph({ spacing: { after: 400 }, children: [] })]),
    ...metaLine("Project", meta.project),
    ...metaLine("Prepared for", meta.preparedFor),
    ...metaLine("Date", meta.date),
    ...metaLine("Revision", meta.revision),
    new Paragraph({ pageBreakBefore: false, spacing: { after: 0 }, children: [] }),
  ]
}

export async function renderDocx(model: DocModel): Promise<Blob> {
  const runningHeader = new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: PAGE_TAB }],
        border: { bottom: HAIRLINE },
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: model.meta.title,
            size: pt(BRAND_TYPE.caption),
            color: BRAND_COLORS.inkMuted,
          }),
          new TextRun({
            text: `\t${model.meta.project ?? BRAND_WORDMARK.primary}`,
            size: pt(BRAND_TYPE.caption),
            color: BRAND_COLORS.inkMuted,
          }),
        ],
      }),
    ],
  })
  const runningFooter = new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: PAGE_TAB }],
        border: { top: HAIRLINE },
        spacing: { before: 80, after: 40 },
        children: [
          new TextRun({
            text: `${model.meta.revision} · ${model.meta.date}`,
            size: pt(BRAND_TYPE.footer),
            color: BRAND_COLORS.inkMuted,
          }),
          new TextRun({
            text: "\tPage ",
            size: pt(BRAND_TYPE.footer),
            color: BRAND_COLORS.inkMuted,
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            size: pt(BRAND_TYPE.footer),
            color: BRAND_COLORS.inkMuted,
          }),
          new TextRun({
            text: " of ",
            size: pt(BRAND_TYPE.footer),
            color: BRAND_COLORS.inkMuted,
          }),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            size: pt(BRAND_TYPE.footer),
            color: BRAND_COLORS.inkMuted,
          }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: BRAND_DISCLAIMER,
            italics: true,
            size: pt(BRAND_TYPE.footer),
            color: BRAND_COLORS.inkMuted,
          }),
        ],
      }),
    ],
  })

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: BRAND_TYPE.docxFont, size: pt(BRAND_TYPE.body) },
        },
      },
    },
    sections: [
      {
        properties: { titlePage: true },
        headers: {
          default: runningHeader,
          first: new Header({ children: [] }),
        },
        footers: {
          default: runningFooter,
          first: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({
                    text: BRAND_DISCLAIMER,
                    italics: true,
                    size: pt(BRAND_TYPE.footer),
                    color: BRAND_COLORS.inkMuted,
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          ...coverChildren(model),
          new Paragraph({ children: [], pageBreakBefore: true }),
          ...bodyChildren(model),
          ...referencesChildren(model),
        ],
      },
    ],
  })
  return Packer.toBlob(doc)
}
