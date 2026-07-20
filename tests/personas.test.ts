import { describe, expect, test } from "bun:test"

import {
  BUILTIN_PERSONAS,
  buildPersonaPreamble,
  getBuiltinPersona,
  personaPreambleForId,
  PERSONA_DOMAINS,
  PERSONA_ICONS,
  PERSONA_PREAMBLE_MAX,
} from "@/lib/personas"

describe("built-in personas are well-formed", () => {
  test("there are two, spanning distinct domains", () => {
    expect(BUILTIN_PERSONAS).toHaveLength(2)
    const domains = new Set(BUILTIN_PERSONAS.map((p) => p.domain))
    expect(domains.size).toBe(2)
  })

  test("ids and names are unique", () => {
    const ids = BUILTIN_PERSONAS.map((p) => p.id)
    const names = BUILTIN_PERSONAS.map((p) => p.name)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(names).size).toBe(names.length)
  })

  for (const persona of BUILTIN_PERSONAS) {
    describe(persona.id, () => {
      test("id is a slug", () => {
        expect(persona.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      })
      test("source is builtin", () => {
        expect(persona.source).toBe("builtin")
      })
      test("domain and icon are allow-listed", () => {
        expect(Object.keys(PERSONA_DOMAINS)).toContain(persona.domain)
        expect(PERSONA_ICONS as readonly string[]).toContain(persona.icon)
      })
      test("core fields are non-empty", () => {
        expect(persona.role.length).toBeGreaterThan(20)
        expect(persona.summary.length).toBeGreaterThan(0)
        expect(persona.priorities.length).toBeGreaterThan(0)
        expect(persona.vocabulary.length).toBeGreaterThan(0)
        expect(persona.antiPatterns.length).toBeGreaterThan(0)
        expect(persona.outputContract.length).toBeGreaterThan(0)
      })
      test("at most four sample prompts", () => {
        expect(persona.samplePrompts.length).toBeLessThanOrEqual(4)
      })
    })
  }
})

describe("buildPersonaPreamble", () => {
  test("wraps in a persona tag and carries the grounding clause", () => {
    for (const persona of BUILTIN_PERSONAS) {
      const preamble = buildPersonaPreamble(persona)
      expect(preamble.startsWith("<persona>")).toBe(true)
      expect(preamble.trimEnd().endsWith("</persona>")).toBe(true)
      expect(preamble).toContain("Ground every claim")
      expect(preamble.length).toBeLessThanOrEqual(PERSONA_PREAMBLE_MAX)
    }
  })

  test("includes the anti-patterns (the guardrails)", () => {
    const persona = getBuiltinPersona("contract-administrator")!
    const preamble = buildPersonaPreamble(persona)
    expect(preamble).toContain("Avoid these anti-patterns")
    expect(preamble).toContain(persona.antiPatterns[0])
  })

  test("truncates an oversized preamble but keeps the closing tag", () => {
    const huge = {
      ...BUILTIN_PERSONAS[0],
      priorities: [Array.from({ length: 5000 }, () => "x").join(" ")],
    }
    const preamble = buildPersonaPreamble(huge)
    expect(preamble.length).toBeLessThanOrEqual(PERSONA_PREAMBLE_MAX)
    expect(preamble.trimEnd().endsWith("</persona>")).toBe(true)
  })
})

describe("registry lookup", () => {
  test("resolves known ids and rejects unknown", () => {
    expect(getBuiltinPersona("technical-director")?.domain).toBe("technical")
    expect(getBuiltinPersona("does-not-exist")).toBeNull()
    expect(getBuiltinPersona(null)).toBeNull()
  })

  test("personaPreambleForId is empty for no/invalid persona", () => {
    expect(personaPreambleForId(null)).toBe("")
    expect(personaPreambleForId("nope")).toBe("")
    expect(personaPreambleForId("technical-director")).toContain("<persona>")
  })
})
