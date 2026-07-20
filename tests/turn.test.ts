import { describe, expect, test } from "bun:test"

import {
  buildParameterInputs,
  composeTurnInput,
  encodeStreamError,
  normalizeTitle,
  parseStreamError,
  STREAM_ERROR_PREFIX,
} from "@/lib/foundry/turn"

describe("normalizeTitle", () => {
  test("collapses whitespace", () =>
    expect(normalizeTitle("  hello   world ")).toBe("hello world"))
  test("empty becomes New chat", () =>
    expect(normalizeTitle("   ")).toBe("New chat"))
  test("truncates to 200 chars", () =>
    expect(normalizeTitle("x".repeat(300))).toHaveLength(200))
})

describe("buildParameterInputs", () => {
  test("empty scope yields no parameter inputs", () => {
    expect(
      buildParameterInputs({ documentIds: [], folderIds: [] }, "o") as object
    ).toEqual({})
  })

  test("Files is a filtered OrbitDocsDocMeta object set (deduped ids)", () => {
    const inputs = buildParameterInputs(
      { documentIds: ["d1", "d1", "", "d2"], folderIds: [] },
      "jacobs-ontology"
    )
    const files = inputs.Files as {
      type: string
      ontology: string
      objectSet: {
        type: string
        objectSet: { type: string; objectType: string }
        where: { type: string; field: string; value: string[] }
      }
    }
    expect(files.type).toBe("objectSet")
    expect(files.ontology).toBe("jacobs-ontology")
    expect(files.objectSet.type).toBe("filter")
    expect(files.objectSet.objectSet.objectType).toBe("OrbitDocsDocMeta")
    expect(files.objectSet.where.field).toBe("documentId")
    expect(files.objectSet.where.value).toEqual(["d1", "d2"])
    expect(inputs.Folders).toBeUndefined()
  })

  test("Folders is a filtered OrbitDocsFolderRegistry object set", () => {
    const inputs = buildParameterInputs(
      { documentIds: [], folderIds: ["f1"] },
      "o"
    )
    const folders = inputs.Folders as {
      objectSet: {
        objectSet: { objectType: string }
        where: { field: string }
      }
    }
    expect(folders.objectSet.objectSet.objectType).toBe(
      "OrbitDocsFolderRegistry"
    )
    expect(folders.objectSet.where.field).toBe("folderId")
    expect(inputs.Files).toBeUndefined()
  })

  test("includes both Files and Folders when the scope has both", () => {
    const inputs = buildParameterInputs(
      { documentIds: ["d1"], folderIds: ["f1"] },
      "o"
    )
    expect(inputs.Files).toBeDefined()
    expect(inputs.Folders).toBeDefined()
  })
})

describe("composeTurnInput", () => {
  test("returns the trimmed input when no preambles", () => {
    expect(composeTurnInput({ userInput: "  hi  " })).toBe("hi")
  })

  test("prepends the persona preamble ahead of the input", () => {
    const out = composeTurnInput({
      userInput: "next",
      personaPreamble: "<persona>LENS</persona>",
    })
    expect(out).toBe("<persona>LENS</persona>\n\nnext")
  })

  test("stacks doc-skill outermost, then persona, then input", () => {
    const out = composeTurnInput({
      userInput: "draft brief",
      personaPreamble: "<persona>LENS</persona>",
      docSkillPrompt: "<doc-skill>STRUCTURE</doc-skill>",
    })
    expect(out.startsWith("<doc-skill>STRUCTURE</doc-skill>")).toBe(true)
    expect(out.indexOf("<doc-skill>")).toBeLessThan(out.indexOf("<persona>"))
    expect(out.indexOf("<persona>")).toBeLessThan(out.indexOf("draft brief"))
  })

  test("blank preambles leave the input unchanged", () => {
    expect(
      composeTurnInput({
        userInput: "hi",
        personaPreamble: "   ",
        docSkillPrompt: "",
      })
    ).toBe("hi")
  })
})

describe("stream error sentinel", () => {
  test("encodes with the prefix", () => {
    expect(encodeStreamError("boom").startsWith(STREAM_ERROR_PREFIX)).toBe(true)
  })
  test("round-trips a generic error", () => {
    const payload = parseStreamError(encodeStreamError("boom"))
    expect(payload?.type).toBe("error")
  })
  test("detects context-window overflow", () => {
    const payload = parseStreamError(
      encodeStreamError("ContextSizeExceeded: too big")
    )
    expect(payload?.type).toBe("context_exceeded")
  })
  test("returns null for normal text", () => {
    expect(parseStreamError("just a normal reply")).toBeNull()
  })
})
