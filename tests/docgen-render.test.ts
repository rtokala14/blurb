import { describe, expect, test } from "bun:test"

import { parseDocEnvelope } from "@/lib/docgen/parse"
import { renderDocx } from "@/lib/docgen/render-docx"
import { renderPdf } from "@/lib/docgen/render-pdf"

const SAMPLE = [
  "```orbit-doc",
  '{"title": "Render Smoke", "docType": "technical-memo", "subtitle": "Renderer test", "project": "C-401"}',
  "```",
  "",
  "## 1. Purpose",
  'Grounded statement <source id="ri.mio.main.media-item.abc" name="WIR-042">12</source> with **bold**.',
  "",
  "- bullet one",
  "- bullet two",
  "",
  "| Item | Status |",
  "| --- | --- |",
  "| WIR-042 | Rejected |",
  "| WIR-043 | Approved |",
  "",
  "> [!risk] Deadline risk.",
  "",
  "## 2. Recommendation",
  Array.from({ length: 40 }, (_, i) => `Paragraph ${i} with enough text to force pagination across pages.`).join(" "),
].join("\n")

describe("renderDocx", () => {
  test("produces a non-trivial .docx blob", async () => {
    const model = parseDocEnvelope(SAMPLE)
    const blob = await renderDocx(model)
    expect(blob.size).toBeGreaterThan(2000)
    // zip magic bytes
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
    expect([head[0], head[1]]).toEqual([0x50, 0x4b])
  })
})

describe("renderPdf", () => {
  test("produces a multi-page PDF with cover + content", async () => {
    const model = parseDocEnvelope(SAMPLE)
    const blob = renderPdf(model)
    expect(blob.size).toBeGreaterThan(2000)
    const text = await blob.text()
    expect(text.startsWith("%PDF")).toBe(true)
    // cover + at least one content page
    const pages = text.match(/\/Type\s*\/Page[^s]/g) ?? []
    expect(pages.length).toBeGreaterThanOrEqual(2)
  })

  test("references section renders when citations exist", async () => {
    const model = parseDocEnvelope(SAMPLE)
    expect(model.citations).toHaveLength(1)
    const blob = renderPdf(model)
    expect(blob.size).toBeGreaterThan(0)
  })
})
