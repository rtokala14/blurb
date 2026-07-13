import { describe, expect, test } from "bun:test"

import { BRAND_COLORS, CALLOUT_TONES } from "@/lib/brand/jacobs"
import {
  blockId,
  citedNumbers,
  sectionBlockIds,
  type DocModel,
} from "@/lib/docgen/model"
import {
  parseBlocks,
  parseDocEnvelope,
  parseInlineRuns,
  parseStreamingDoc,
  serializeDocModel,
} from "@/lib/docgen/parse"
import {
  buildDocSkillPrompt,
  DOC_SKILL_PROMPT_MAX,
  DOC_SKILLS,
  getDocSkill,
} from "@/lib/docgen/skills"

/* ------------------------------------------------------------------ */
/* Brand                                                                */
/* ------------------------------------------------------------------ */

describe("brand tokens", () => {
  test("every color is 6-digit hex without #", () => {
    for (const value of Object.values(BRAND_COLORS)) {
      expect(value).toMatch(/^[0-9a-f]{6}$/)
    }
  })
  test("every callout tone has an edge color and label", () => {
    for (const tone of Object.values(CALLOUT_TONES)) {
      expect(tone.edge).toMatch(/^[0-9a-f]{6}$/)
      expect(tone.label.length).toBeGreaterThan(0)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Inline runs                                                          */
/* ------------------------------------------------------------------ */

describe("parseInlineRuns", () => {
  test("bold, italic and cite markers", () => {
    const runs = parseInlineRuns("plain **bold** and *ital* then ⟦2⟧ end")
    expect(runs).toEqual([
      { t: "text", text: "plain " },
      { t: "text", text: "bold", bold: true },
      { t: "text", text: " and " },
      { t: "text", text: "ital", italic: true },
      { t: "text", text: " then " },
      { t: "cite", n: 2 },
      { t: "text", text: " end" },
    ])
  })
  test("empty text still yields one run", () => {
    expect(parseInlineRuns("")).toEqual([{ t: "text", text: "" }])
  })
})

/* ------------------------------------------------------------------ */
/* Blocks                                                               */
/* ------------------------------------------------------------------ */

describe("parseBlocks", () => {
  test("headings, lists, tables, callouts", () => {
    const blocks = parseBlocks(
      [
        "## 1. Purpose",
        "First paragraph.",
        "",
        "- one",
        "- two",
        "",
        "1. first",
        "2. second",
        "",
        "| Item | Status |",
        "| --- | --- |",
        "| WIR-042 | Rejected |",
        "| WIR-043 | Approved |",
        "",
        "> [!risk] Notice deadline is close.",
      ].join("\n")
    )
    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "bullets",
      "numbered",
      "table",
      "callout",
    ])
    const table = blocks[4] as Extract<(typeof blocks)[number], { kind: "table" }>
    expect(table.header).toEqual(["Item", "Status"])
    expect(table.rows).toEqual([
      ["WIR-042", "Rejected"],
      ["WIR-043", "Approved"],
    ])
    const callout = blocks[5] as Extract<(typeof blocks)[number], { kind: "callout" }>
    expect(callout.tone).toBe("risk")
  })

  test("ragged table rows normalize to header width", () => {
    const blocks = parseBlocks("| A | B |\n| --- | --- |\n| only |")
    const table = blocks[0] as Extract<(typeof blocks)[number], { kind: "table" }>
    expect(table.rows).toEqual([["only", ""]])
  })

  test("blank-separated numbered items stay one list", () => {
    const blocks = parseBlocks("1. first\n\n2. second\n\n3. third")
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe("numbered")
    const list = blocks[0] as Extract<
      (typeof blocks)[number],
      { kind: "bullets" | "numbered" }
    >
    expect(list.items).toHaveLength(3)
  })

  test("a blank line before different content still closes the list", () => {
    const blocks = parseBlocks("- one\n- two\n\nA paragraph after.")
    expect(blocks.map((b) => b.kind)).toEqual(["bullets", "paragraph"])
  })

  test("multi-line callout bodies join", () => {
    const blocks = parseBlocks("> [!note] first line\n> second line")
    const callout = blocks[0] as Extract<(typeof blocks)[number], { kind: "callout" }>
    expect(callout.runs[0]).toEqual({ t: "text", text: "first line second line" })
  })
})

/* ------------------------------------------------------------------ */
/* Envelope                                                             */
/* ------------------------------------------------------------------ */

const GOLDEN = [
  "```orbit-doc",
  '{"title": "WIR Package Review", "docType": "review-report", "project": "Contract C-401"}',
  "```",
  "",
  "## 1. Scope of review",
  'The package covers three inspection requests <source id="ri.mio.main.media-item.abc" name="WIR-042" text="quote here">12</source>.',
  "",
  "| Item | Status |",
  "| --- | --- |",
  "| WIR-042 | Rejected |",
  "",
  "> [!action] Resubmit with updated hold points.",
].join("\n")

describe("parseDocEnvelope", () => {
  test("golden envelope: meta, blocks, lifted citations", () => {
    const model = parseDocEnvelope(GOLDEN)
    expect(model.meta.title).toBe("WIR Package Review")
    expect(model.meta.docType).toBe("review-report")
    expect(model.meta.project).toBe("Contract C-401")
    expect(model.meta.revision).toBe("Rev A")
    expect(model.parseWarnings).toEqual([])
    expect(model.citations).toHaveLength(1)
    expect(model.citations[0].mediaRid).toBe("ri.mio.main.media-item.abc")
    expect(model.citations[0].docName).toBe("WIR-042")
    // citation became a cite run inside the paragraph
    const paragraph = model.blocks.find((b) => b.kind === "paragraph")!
    expect(
      paragraph.kind === "paragraph" &&
        paragraph.runs.some((r) => r.t === "cite" && r.n === 1)
    ).toBe(true)
  })

  test("missing envelope falls back to plain markdown with a warning", () => {
    const model = parseDocEnvelope("# My Draft\n\nBody text.", {
      fallbackDocType: "technical-memo",
    })
    expect(model.meta.title).toBe("My Draft")
    expect(model.meta.docType).toBe("technical-memo")
    expect(model.parseWarnings.length).toBeGreaterThan(0)
    // content is never lost
    expect(model.blocks.some((b) => b.kind === "paragraph")).toBe(true)
  })

  test("malformed envelope JSON warns but keeps the body", () => {
    const model = parseDocEnvelope("```orbit-doc\n{not json\n```\n\n## Section\nText.")
    expect(model.parseWarnings.length).toBeGreaterThan(0)
    expect(model.blocks.map((b) => b.kind)).toEqual(["heading", "paragraph"])
  })

  test("duplicate H1 matching the envelope title is dropped", () => {
    const model = parseDocEnvelope(
      '```orbit-doc\n{"title": "Same Title", "docType": "technical-memo"}\n```\n# Same Title\n\nBody.'
    )
    expect(model.blocks[0].kind).toBe("paragraph")
  })

  test("leading agent chatter before the first heading is dropped", () => {
    const model = parseDocEnvelope(
      '```orbit-doc\n{"title": "Brief", "docType": "executive-brief"}\n```\n' +
        "I now have comprehensive data from the document to produce the brief.\n\n" +
        "Final Answer:\n\n## 1. Situation\nReal content stays."
    )
    expect(model.blocks.map((b) => b.kind)).toEqual(["heading", "paragraph"])
    const paragraph = model.blocks[1]
    expect(
      paragraph.kind === "paragraph" &&
        paragraph.runs.some((r) => r.t === "text" && r.text.includes("Real content"))
    ).toBe(true)
  })

  test("legitimate leading paragraphs survive chatter stripping", () => {
    const model = parseDocEnvelope(
      "The settlement readings exceed the alert threshold.\n\n## 1. Analysis\nBody."
    )
    expect(model.blocks[0].kind).toBe("paragraph")
  })

  test("empty input yields a valid empty model", () => {
    const model = parseDocEnvelope("", { fallbackTitle: "Draft" })
    expect(model.meta.title).toBe("Draft")
    expect(model.blocks).toEqual([])
  })
})

describe("parseStreamingDoc", () => {
  test("holds back an unterminated orbit-doc fence", () => {
    const model = parseStreamingDoc('```orbit-doc\n{"title": "Part')
    expect(model.blocks).toEqual([])
  })
  test("holds back a trailing partial source tag", () => {
    const model = parseStreamingDoc(
      GOLDEN + '\n\nMore text <source id="ri.mio.main.media-item.xyz"'
    )
    expect(model.citations).toHaveLength(1)
    const last = model.blocks[model.blocks.length - 1]
    expect(last.kind).toBe("paragraph")
  })
  test("parses complete text identically to the full parser", () => {
    expect(parseStreamingDoc(GOLDEN).blocks.map((b) => b.kind)).toEqual(
      parseDocEnvelope(GOLDEN).blocks.map((b) => b.kind)
    )
  })
})

describe("serializeDocModel round-trip", () => {
  test("parse(serialize(m)) preserves structure, meta and citations", () => {
    const original = parseDocEnvelope(GOLDEN)
    const reparsed = parseDocEnvelope(serializeDocModel(original))
    expect(reparsed.meta.title).toBe(original.meta.title)
    expect(reparsed.meta.docType).toBe(original.meta.docType)
    expect(reparsed.meta.project).toBe(original.meta.project)
    expect(reparsed.blocks.map((b) => b.kind)).toEqual(
      original.blocks.map((b) => b.kind)
    )
    expect(reparsed.citations).toHaveLength(original.citations.length)
    expect(reparsed.citations[0].mediaRid).toBe(original.citations[0].mediaRid)
    expect(reparsed.citations[0].pagesLabel).toBe(original.citations[0].pagesLabel)
  })
})

/* ------------------------------------------------------------------ */
/* Model helpers                                                        */
/* ------------------------------------------------------------------ */

describe("model helpers", () => {
  test("sectionBlockIds spans until the next same-or-higher heading", () => {
    const model = parseDocEnvelope(
      "## A\npara a\n\n### A.1\npara a1\n\n## B\npara b"
    )
    const first = model.blocks[0]
    const ids = sectionBlockIds(model, first.id)
    expect(ids).toHaveLength(4) // ## A, para, ### A.1, para
    expect(ids).not.toContain(model.blocks[4].id) // ## B
  })
  test("citedNumbers finds cites in paragraphs, lists and callouts", () => {
    const model = parseDocEnvelope(
      'Text <source id="ri.x" name="D">1</source>\n\n- item <source id="ri.x" name="D">2</source>\n\n> [!note] call <source id="ri.y" name="E">3</source>'
    )
    expect(citedNumbers(model.blocks)).toEqual([1, 2, 3])
  })
  test("blockId is unique", () => {
    const ids = new Set(Array.from({ length: 200 }, () => blockId()))
    expect(ids.size).toBe(200)
  })
})

/* ------------------------------------------------------------------ */
/* Skills                                                               */
/* ------------------------------------------------------------------ */

describe("doc skills", () => {
  test("seven skills with unique ids and complete fields", () => {
    expect(DOC_SKILLS).toHaveLength(7)
    const ids = new Set(DOC_SKILLS.map((s) => s.id))
    expect(ids.size).toBe(7)
    for (const skill of DOC_SKILLS) {
      expect(skill.structure.length).toBeGreaterThanOrEqual(4)
      expect(skill.antiPatterns.length).toBeGreaterThanOrEqual(3)
      expect(skill.guidance.length).toBeGreaterThan(40)
      expect(skill.briefPlaceholder.startsWith("e.g.")).toBe(true)
    }
  })

  test("prompt carries structure contract, envelope spec and grounding", () => {
    const prompt = buildDocSkillPrompt(DOC_SKILLS[0])
    expect(prompt).toContain("<doc-skill>")
    expect(prompt).toContain("Required structure")
    expect(prompt).toContain("orbit-doc")
    expect(prompt).toContain(`"docType": "${DOC_SKILLS[0].id}"`)
    expect(prompt).toContain("[TO CONFIRM")
    expect(prompt).toContain("Never mention colors")
  })

  test("prompt stays under the budget for every skill", () => {
    for (const skill of DOC_SKILLS) {
      expect(buildDocSkillPrompt(skill).length).toBeLessThanOrEqual(
        DOC_SKILL_PROMPT_MAX
      )
    }
  })

  test("getDocSkill resolves known ids and rejects unknown", () => {
    expect(getDocSkill("review-report")?.name).toBe("Document Review Report")
    expect(getDocSkill("nope")).toBeNull()
    expect(getDocSkill(null)).toBeNull()
  })
})
