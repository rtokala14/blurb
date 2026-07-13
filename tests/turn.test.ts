import { describe, expect, test } from "bun:test"

import {
  buildCompactContext,
  buildParameterInputs,
  encodeStreamError,
  normalizeMode,
  normalizeTitle,
  parseStreamError,
  prepareTurnRequest,
  STREAM_ERROR_PREFIX,
  summarizeTrace,
  THINKING_MODE,
  wrapRegularModePrompt,
} from "@/lib/foundry/turn"

const AGENTS = { primary: "ri.agent.primary", thinking: "ri.agent.thinking" }

describe("normalizeMode", () => {
  test("maps deep_research to thinking", () =>
    expect(normalizeMode("deep_research")).toBe("thinking"))
  test("keeps thinking", () => expect(normalizeMode("thinking")).toBe("thinking"))
  test("defaults to regular", () => expect(normalizeMode("whatever")).toBe("regular"))
  test("handles null", () => expect(normalizeMode(null)).toBe("regular"))
})

describe("normalizeTitle", () => {
  test("collapses whitespace", () =>
    expect(normalizeTitle("  hello   world ")).toBe("hello world"))
  test("empty becomes New chat", () => expect(normalizeTitle("   ")).toBe("New chat"))
  test("truncates to 200 chars", () =>
    expect(normalizeTitle("x".repeat(300))).toHaveLength(200))
})

describe("buildParameterInputs", () => {
  test("builds a union objectSet over the selected docs", () => {
    const inputs = buildParameterInputs(["d1", "d2"], {
      mode: "regular",
      ontology: "jacobs-ontology",
    })
    const userDocs = inputs.userDocs as Record<string, unknown>
    expect(userDocs.type).toBe("objectSet")
    expect(userDocs.ontology).toBe("jacobs-ontology")
    const objectSet = userDocs.objectSet as {
      type: string
      objectSets: unknown[]
    }
    expect(objectSet.type).toBe("union")
    expect(objectSet.objectSets).toHaveLength(2)
  })

  test("omits userDocs when no docs", () => {
    expect(buildParameterInputs([], { mode: "regular", ontology: "o" })).toEqual({})
  })

  test("adds prevContext only in thinking mode with context", () => {
    const withCtx = buildParameterInputs(["d1"], {
      mode: THINKING_MODE,
      compactContext: "prev",
      ontology: "o",
    })
    expect(withCtx.prevContext).toEqual({ type: "string", value: "prev" })
    const regular = buildParameterInputs(["d1"], {
      mode: "regular",
      compactContext: "prev",
      ontology: "o",
    })
    expect(regular.prevContext).toBeUndefined()
  })
})

describe("buildCompactContext", () => {
  test("assembles summary + first/latest user + latest assistant", () => {
    const context = buildCompactContext("SUMMARY", [
      { id: "1", isAgent: false, message: "first q", createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", isAgent: true, message: "first a", createdAt: "2026-01-01T00:01:00Z" },
      { id: "3", isAgent: false, message: "second q", createdAt: "2026-01-01T00:02:00Z" },
      { id: "4", isAgent: true, message: "second a", createdAt: "2026-01-01T00:03:00Z" },
    ])
    expect(context).toContain("SUMMARY")
    expect(context).toContain("Initial user message:\nfirst q")
    expect(context).toContain("Latest user message:\nsecond q")
    expect(context).toContain("Latest assistant message:\nsecond a")
  })

  test("empty when nothing to summarize", () => {
    expect(buildCompactContext("", [])).toBe("")
  })
})

describe("wrapRegularModePrompt", () => {
  test("passes through when no context", () =>
    expect(wrapRegularModePrompt("", "hi")).toBe("hi"))
  test("wraps with context", () => {
    const wrapped = wrapRegularModePrompt("CTX", "question")
    expect(wrapped).toContain("CTX")
    expect(wrapped).toContain("Current user message:\nquestion")
  })
})

describe("prepareTurnRequest", () => {
  test("regular mode wraps input and targets primary agent", () => {
    const turn = prepareTurnRequest({
      mode: "regular",
      summary: "SUM",
      persistedMessages: [
        { id: "1", isAgent: false, message: "hi", createdAt: "2026-01-01T00:00:00Z" },
      ],
      userInput: "next",
      userDocs: ["d1"],
      ontology: "o",
      agents: AGENTS,
    })
    expect(turn.agentRid).toBe(AGENTS.primary)
    expect(turn.userInput).toContain("Current user message:\nnext")
    expect(turn.parameterInputs.userDocs).toBeDefined()
  })

  test("thinking mode uses the raw input and thinking agent", () => {
    const turn = prepareTurnRequest({
      mode: "thinking",
      summary: null,
      persistedMessages: [],
      userInput: "deep question",
      userDocs: ["d1"],
      ontology: "o",
      agents: AGENTS,
    })
    expect(turn.agentRid).toBe(AGENTS.thinking)
    expect(turn.userInput).toBe("deep question")
  })

  test("prepends the persona preamble in regular mode, ahead of the wrapped input", () => {
    const turn = prepareTurnRequest({
      mode: "regular",
      summary: null,
      persistedMessages: [],
      userInput: "next",
      userDocs: ["d1"],
      ontology: "o",
      agents: AGENTS,
      personaPreamble: "<persona>ACT AS X</persona>",
    })
    expect(turn.userInput.startsWith("<persona>ACT AS X</persona>")).toBe(true)
    expect(turn.userInput).toContain("next")
  })

  test("prepends the persona preamble in thinking mode, ahead of the raw input", () => {
    const turn = prepareTurnRequest({
      mode: "thinking",
      summary: null,
      persistedMessages: [],
      userInput: "deep question",
      userDocs: ["d1"],
      ontology: "o",
      agents: AGENTS,
      personaPreamble: "<persona>ACT AS Y</persona>",
    })
    expect(turn.userInput).toBe("<persona>ACT AS Y</persona>\n\ndeep question")
  })

  test("doc-skill prompt stacks outermost, ahead of the persona", () => {
    const turn = prepareTurnRequest({
      mode: "regular",
      summary: null,
      persistedMessages: [],
      userInput: "draft brief",
      userDocs: ["d1"],
      ontology: "o",
      agents: AGENTS,
      personaPreamble: "<persona>LENS</persona>",
      docSkillPrompt: "<doc-skill>STRUCTURE</doc-skill>",
    })
    expect(turn.userInput.startsWith("<doc-skill>STRUCTURE</doc-skill>")).toBe(true)
    expect(turn.userInput.indexOf("<doc-skill>")).toBeLessThan(
      turn.userInput.indexOf("<persona>")
    )
    expect(turn.userInput).toContain("draft brief")
  })

  test("no persona preamble leaves the input unchanged", () => {
    const withEmpty = prepareTurnRequest({
      mode: "regular",
      summary: null,
      persistedMessages: [],
      userInput: "hi",
      userDocs: ["d1"],
      ontology: "o",
      agents: AGENTS,
      personaPreamble: "   ",
    })
    expect(withEmpty.userInput).toBe("hi")
  })

  test("reuses pinned version only for the same agent", () => {
    const same = prepareTurnRequest({
      mode: "regular",
      summary: null,
      persistedMessages: [],
      userInput: "x",
      userDocs: ["d1"],
      ontology: "o",
      agents: AGENTS,
      pinnedAgentRid: AGENTS.primary,
      pinnedAgentVersion: "1.2",
    })
    expect(same.agentVersion).toBe("1.2")
    const different = prepareTurnRequest({
      mode: "regular",
      summary: null,
      persistedMessages: [],
      userInput: "x",
      userDocs: ["d1"],
      ontology: "o",
      agents: AGENTS,
      pinnedAgentRid: AGENTS.thinking,
      pinnedAgentVersion: "9.9",
    })
    expect(different.agentVersion).toBeNull()
  })
})

describe("summarizeTrace", () => {
  test("the agent's narration is the step line; tool names only pick icons", () => {
    const steps = summarizeTrace({
      status: "IN_PROGRESS",
      toolCallGroups: [
        {
          toolCalls: [
            {
              toolMetadata: { name: "Object Query Tool", type: "FUNCTION" },
              input: {
                thought: "I need to find the relevant contracts.",
                inputs: { secretRid: "ri.should.never.leak" },
              },
              output: { type: "success", output: { raw: "ri.leaky.output" } },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolMetadata: { name: "Document Retrieval", type: "FUNCTION" },
              input: { thought: "Now reviewing the inspection checklist sections." },
            },
          ],
        },
      ],
    })
    expect(steps).toHaveLength(2)
    expect(steps[0].label).toBe("I need to find the relevant contracts.")
    expect(steps[0].kind).toBe("search")
    expect(steps[1].label).toBe("Now reviewing the inspection checklist sections.")
    expect(steps[1].kind).toBe("read")
    // tool names and raw inputs/outputs must never appear as content
    expect(JSON.stringify(steps)).not.toContain("Object Query Tool")
    expect(JSON.stringify(steps)).not.toContain("ri.should.never.leak")
    expect(JSON.stringify(steps)).not.toContain("ri.leaky.output")
  })

  test("consecutive identical narration collapses; distinct lines stay", () => {
    const call = (thought: string) => ({
      toolMetadata: { name: "Semantic Search", type: "FUNCTION" },
      input: { thought },
    })
    const steps = summarizeTrace({
      toolCallGroups: [
        { toolCalls: [call("Scanning the WIR package."), call("Scanning the WIR package.")] },
        { toolCalls: [call("Checking the test certificates.")] },
      ],
    })
    expect(steps.map((s) => s.label)).toEqual([
      "Scanning the WIR package.",
      "Checking the test certificates.",
    ])
  })

  test("truncates long narration and normalizes whitespace", () => {
    const steps = summarizeTrace({
      toolCallGroups: [
        {
          toolCalls: [
            {
              toolMetadata: { name: "Tool" },
              input: { thought: `a  b\n\nc ${"x".repeat(400)}` },
            },
          ],
        },
      ],
    })
    expect(steps[0].label.length).toBeLessThanOrEqual(220)
    expect(steps[0].label).toContain("a b c")
    expect(steps[0].label.endsWith("…")).toBe(true)
  })

  test("empty for missing or empty traces", () => {
    expect(summarizeTrace(null)).toEqual([])
    expect(summarizeTrace({ status: "COMPLETE" })).toEqual([])
    expect(summarizeTrace({ toolCallGroups: [] })).toEqual([])
  })

  test("calls without narration fall back to a friendly activity label", () => {
    const steps = summarizeTrace({
      toolCallGroups: [
        { toolCalls: [{ toolMetadata: { name: "Semantic Search" } }] },
        { toolCalls: [{ input: { thought: "" } }] },
      ],
    })
    expect(steps[0].label).toBe("Searching the documents")
    expect(steps[1].label).toBe("Working")
    expect(steps[1].kind).toBe("tool")
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
    const payload = parseStreamError(encodeStreamError("ContextSizeExceeded: too big"))
    expect(payload?.type).toBe("context_exceeded")
  })
  test("returns null for normal text", () => {
    expect(parseStreamError("just a normal reply")).toBeNull()
  })
})
