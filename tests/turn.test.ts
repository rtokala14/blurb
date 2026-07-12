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
  test("maps tool calls to high-level steps with thoughts", () => {
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
              input: { thought: "Fetching pages 4-9." },
            },
          ],
        },
      ],
    })
    expect(steps).toHaveLength(2)
    expect(steps[0].kind).toBe("search")
    expect(steps[0].label).toBe("Object Query Tool")
    expect(steps[0].detail).toBe("I need to find the relevant contracts.")
    expect(steps[1].kind).toBe("read")
    // raw tool inputs/outputs must never appear anywhere in the summary
    expect(JSON.stringify(steps)).not.toContain("ri.should.never.leak")
    expect(JSON.stringify(steps)).not.toContain("ri.leaky.output")
  })

  test("collapses consecutive calls to the same tool with a counter", () => {
    const call = (thought: string) => ({
      toolMetadata: { name: "Semantic Search", type: "FUNCTION" },
      input: { thought },
    })
    const steps = summarizeTrace({
      toolCallGroups: [
        { toolCalls: [call("first pass"), call("second pass")] },
        { toolCalls: [call("third pass")] },
      ],
    })
    expect(steps).toHaveLength(1)
    expect(steps[0].label).toBe("Semantic Search ×3")
    expect(steps[0].detail).toBe("third pass")
  })

  test("truncates long thoughts and normalizes whitespace", () => {
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
    expect(steps[0].detail!.length).toBeLessThanOrEqual(160)
    expect(steps[0].detail).toContain("a b c")
    expect(steps[0].detail!.endsWith("…")).toBe(true)
  })

  test("empty for missing or empty traces", () => {
    expect(summarizeTrace(null)).toEqual([])
    expect(summarizeTrace({ status: "COMPLETE" })).toEqual([])
    expect(summarizeTrace({ toolCallGroups: [] })).toEqual([])
  })

  test("unnamed tools get a generic label", () => {
    const steps = summarizeTrace({
      toolCallGroups: [{ toolCalls: [{ input: { thought: "hmm" } }] }],
    })
    expect(steps[0].label).toBe("Working")
    expect(steps[0].kind).toBe("tool")
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
