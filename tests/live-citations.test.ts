import { describe, expect, test } from "bun:test"

import {
  parseFirstPage,
  formatPages,
  parseLiveMessage,
  parseStreamingLiveText,
  stripSourceTags,
} from "@/lib/live-citations"

describe("parseFirstPage", () => {
  test("single page", () => expect(parseFirstPage("12")).toBe(12))
  test("range", () => expect(parseFirstPage("2-3")).toBe(2))
  test("list", () => expect(parseFirstPage("642, 708, 871")).toBe(642))
  test("empty", () => expect(parseFirstPage("  ")).toBe(0))
})

describe("formatPages", () => {
  test("single", () => expect(formatPages("12")).toBe("p. 12"))
  test("range", () => expect(formatPages("2-3")).toBe("pp. 2-3"))
  test("list", () => expect(formatPages("1, 4")).toBe("pp. 1, 4"))
})

describe("parseLiveMessage", () => {
  test("converts a source tag to a numbered marker", () => {
    const raw =
      'The term auto-renews <source id="ri.mio.main.media-item.abc" name="MSA.pdf" text="ninety days">12</source> annually.'
    const parsed = parseLiveMessage(raw)
    expect(parsed.content).toBe("The term auto-renews ⟦1⟧ annually.")
    expect(parsed.citations).toHaveLength(1)
    expect(parsed.citations[0]).toMatchObject({
      n: 1,
      mediaRid: "ri.mio.main.media-item.abc",
      docName: "MSA.pdf",
      pages: "12",
      firstPage: 12,
      quote: "ninety days",
    })
  })

  test("deduplicates identical citations to one number", () => {
    const raw =
      'A <source id="ri.mio.main.media-item.x" name="D">4</source> and B <source id="ri.mio.main.media-item.x" name="D">4</source>.'
    const parsed = parseLiveMessage(raw)
    expect(parsed.content).toBe("A ⟦1⟧ and B ⟦1⟧.")
    expect(parsed.citations).toHaveLength(1)
  })

  test("numbers distinct citations sequentially", () => {
    const raw =
      '<source id="ri.mio.main.media-item.a" name="A">1</source> <source id="ri.mio.main.media-item.b" name="B">2</source>'
    const parsed = parseLiveMessage(raw)
    expect(parsed.content).toBe("⟦1⟧ ⟦2⟧")
    expect(parsed.citations.map((c) => c.n)).toEqual([1, 2])
  })

  test("tolerates missing optional attributes", () => {
    const raw = '<source id="ri.mio.main.media-item.z">7</source>'
    const parsed = parseLiveMessage(raw)
    expect(parsed.citations[0].docName).toBe("Source document")
    expect(parsed.citations[0].quote).toBeUndefined()
  })

  test("drops tags with no id", () => {
    const parsed = parseLiveMessage('text <source name="x">1</source> more')
    expect(parsed.citations).toHaveLength(0)
    expect(parsed.content).toContain("text")
  })
})

describe("parseStreamingLiveText", () => {
  test("hides a trailing incomplete tag mid-stream", () => {
    const partial = "The answer is here <source id=\"ri.mio.main.media-item.a\" name=\"A\">1"
    const parsed = parseStreamingLiveText(partial)
    expect(parsed.content).toBe("The answer is here")
    expect(parsed.citations).toHaveLength(0)
  })

  test("hides a bare partial tag prefix", () => {
    const parsed = parseStreamingLiveText("Some text <sou")
    expect(parsed.content).toBe("Some text")
  })

  test("renders complete tags even with trailing partial", () => {
    const raw =
      'Done <source id="ri.mio.main.media-item.a" name="A">1</source> and <sour'
    const parsed = parseStreamingLiveText(raw)
    expect(parsed.content).toContain("⟦1⟧")
    expect(parsed.citations).toHaveLength(1)
  })
})

describe("stripSourceTags", () => {
  test("removes tags entirely for exports", () => {
    const raw = 'Fact <source id="ri.mio.main.media-item.a" name="A">1</source> here.'
    expect(stripSourceTags(raw)).toBe("Fact here.")
  })
})

/* ------------------------------------------------------------------ */
/* Bracket-JSON citation format (current agent emission style)          */
/* ------------------------------------------------------------------ */

const bracketCite = (payload: Record<string, unknown>) =>
  `【${JSON.stringify(payload)}】`

describe("parseLiveMessage — bracket citations", () => {
  test("converts a bracket citation to a numbered marker", () => {
    const raw =
      "The system uses Q-Learning." +
      bracketCite({
        type: "citation",
        doc: "AIML1.pdf",
        name: "AIML1.pdf",
        page: 23,
        quote: "we have chosen the Q-Learning algorithm",
      })
    const parsed = parseLiveMessage(raw)
    expect(parsed.content).toBe("The system uses Q-Learning.⟦1⟧")
    expect(parsed.citations).toHaveLength(1)
    expect(parsed.citations[0]).toMatchObject({
      n: 1,
      mediaRid: "",
      docName: "AIML1.pdf",
      pages: "23",
      firstPage: 23,
      quote: "we have chosen the Q-Learning algorithm",
    })
  })

  test("dedupes identical doc+page pairs and numbers across both formats", () => {
    const raw =
      'a <source id="ri.mio.main.media-item.x" name="MSA.pdf">4</source> b ' +
      bracketCite({ type: "citation", doc: "AIML1.pdf", page: 3 }) +
      " c " +
      bracketCite({ type: "citation", doc: "AIML1.pdf", page: 3 })
    const parsed = parseLiveMessage(raw)
    expect(parsed.citations).toHaveLength(2)
    expect(parsed.content).toBe("a ⟦1⟧ b ⟦2⟧ c ⟦2⟧")
  })

  test("falls back to doc field when name is missing", () => {
    const parsed = parseLiveMessage(
      bracketCite({ type: "citation", doc: "SustainIQ User Manual.pdf", page: 7 })
    )
    expect(parsed.citations[0].docName).toBe("SustainIQ User Manual.pdf")
  })

  test("leaves non-citation JSON and plain CJK brackets untouched", () => {
    const nonCitation = `【{"type":"note","doc":"x"}】`
    const prose = "【重要】 remember this"
    expect(parseLiveMessage(nonCitation).content).toBe(nonCitation)
    expect(parseLiveMessage(nonCitation).citations).toHaveLength(0)
    expect(parseLiveMessage(prose).content).toBe(prose)
  })
})

describe("parseStreamingLiveText — bracket citations", () => {
  test("hides a trailing incomplete bracket citation mid-stream", () => {
    const partial = 'The answer 【{"type":"citation","doc":"A.pdf","pa'
    const parsed = parseStreamingLiveText(partial)
    expect(parsed.content).toBe("The answer")
    expect(parsed.citations).toHaveLength(0)
  })

  test("renders complete bracket citations with trailing partial", () => {
    const raw =
      "Done" +
      bracketCite({ type: "citation", doc: "A.pdf", page: 1 }) +
      " and 【{\"type"
    const parsed = parseStreamingLiveText(raw)
    expect(parsed.content).toBe("Done⟦1⟧ and")
    expect(parsed.citations).toHaveLength(1)
  })
})

describe("stripSourceTags — bracket citations", () => {
  test("removes bracket citations for exports, keeps other brackets", () => {
    const raw =
      "Fact " +
      bracketCite({ type: "citation", doc: "A.pdf", page: 1 }) +
      " here. 【重要】 stays."
    expect(stripSourceTags(raw)).toBe("Fact here. 【重要】 stays.")
  })
})
