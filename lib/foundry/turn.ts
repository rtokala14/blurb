/**
 * Pure turn-preparation logic for AIP agent chats, ported from the PoC's
 * services/session_v2.py. No I/O — unit-testable.
 */

export const REGULAR_MODE = "regular"
export const THINKING_MODE = "thinking"
const LEGACY_DEEP_RESEARCH_MODE = "deep_research"

export type ChatMode = typeof REGULAR_MODE | typeof THINKING_MODE

export function normalizeMode(value: string | null | undefined): ChatMode {
  if (value === THINKING_MODE || value === LEGACY_DEEP_RESEARCH_MODE) {
    return THINKING_MODE
  }
  return REGULAR_MODE
}

export function normalizeTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) return "New chat"
  return normalized.slice(0, 200)
}

export interface PersistedMessage {
  id: string
  isAgent: boolean
  message: string
  createdAt?: string | null
}

function sortMessages<T extends PersistedMessage>(messages: T[]): T[] {
  return [...messages].sort((a, b) => {
    const ta = a.createdAt ?? ""
    const tb = b.createdAt ?? ""
    if (ta !== tb) return ta < tb ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * Build the objectSet parameter scoping the agent to the selected documents.
 * Shape must match the PoC exactly (union of per-doc primaryKey filters).
 */
export function buildParameterInputs(
  userDocs: string[],
  {
    mode,
    compactContext = "",
    ontology,
  }: { mode: string; compactContext?: string; ontology: string }
): Record<string, unknown> {
  const parameterInputs: Record<string, unknown> = {}

  if (userDocs.length > 0) {
    parameterInputs.userDocs = {
      type: "objectSet",
      ontology,
      objectSet: {
        type: "union",
        objectSets: userDocs.map((docId) => ({
          type: "filter",
          objectSet: { type: "base", objectType: "OrbitDocsList" },
          where: { type: "eq", field: "primaryKey_", value: docId },
        })),
      },
    }
  }

  if (normalizeMode(mode) === THINKING_MODE && compactContext.trim()) {
    parameterInputs.prevContext = { type: "string", value: compactContext }
  }

  return parameterInputs
}

/** Compact continuation context: summary + first/latest user + latest agent. */
export function buildCompactContext(
  summary: string | null | undefined,
  persistedMessages: PersistedMessage[]
): string {
  const ordered = sortMessages(persistedMessages)
  if (ordered.length === 0 && !(summary ?? "").trim()) return ""

  const firstUser = ordered.find((m) => !m.isAgent)
  const latestAgent = [...ordered].reverse().find((m) => m.isAgent)
  const latestUser = [...ordered]
    .reverse()
    .find((m) => !m.isAgent && m !== firstUser)

  const sections: string[] = []
  if ((summary ?? "").trim()) sections.push(summary!.trim())
  if (firstUser?.message.trim())
    sections.push(`Initial user message:\n${firstUser.message.trim()}`)
  if (latestUser?.message.trim())
    sections.push(`Latest user message:\n${latestUser.message.trim()}`)
  if (latestAgent?.message.trim())
    sections.push(`Latest assistant message:\n${latestAgent.message.trim()}`)

  return sections.join("\n\n").trim()
}

export function wrapRegularModePrompt(
  compactContext: string,
  userInput: string
): string {
  const context = compactContext.trim()
  const message = userInput.trim()
  if (!context) return message
  return (
    "Use the following chat context to answer the user's latest question.\n\n" +
    `${context}\n\n` +
    `Current user message:\n${message}`
  ).trim()
}

export function buildSummaryPrompt(transcript: string): string {
  return (
    "Summarize the following chat so a future response can continue it reliably.\n" +
    "Be concise, factual, and preserve user intent and important document-backed facts.\n\n" +
    "Return markdown with exactly these sections:\n" +
    "## User Goal\n" +
    "## Important Facts From Documents\n" +
    "## Decisions Already Made\n" +
    "## Open Questions\n" +
    "## Tone And Format Constraints\n\n" +
    `Transcript:\n${transcript}`
  )
}

export function buildTitlePrompt(transcript: string): string {
  return (
    "Write a short title for this chat.\n" +
    "Keep it specific, professional, and under 8 words.\n" +
    "Do not use quotes, markdown, numbering, or trailing punctuation.\n" +
    "Return only the title text.\n\n" +
    `Transcript:\n${transcript}`
  )
}

export interface TurnRequest {
  agentRid: string
  agentVersion: string | null
  userInput: string
  parameterInputs: Record<string, unknown>
  compactContext: string
}

/** Prepend an instruction preamble ahead of the turn input (blank → unchanged). */
function withPreamble(preamble: string | undefined, input: string): string {
  const trimmed = (preamble ?? "").trim()
  return trimmed ? `${trimmed}\n\n${input}` : input
}

export function prepareTurnRequest({
  mode,
  summary,
  persistedMessages,
  userInput,
  userDocs,
  ontology,
  agents,
  pinnedAgentRid,
  pinnedAgentVersion,
  personaPreamble,
  docSkillPrompt,
}: {
  mode: string
  summary: string | null | undefined
  persistedMessages: PersistedMessage[]
  userInput: string
  userDocs: string[]
  ontology: string
  agents: { primary: string; thinking: string }
  /** session's current agent rid/version — version reused only if same agent */
  pinnedAgentRid?: string | null
  pinnedAgentVersion?: string | null
  /** optional persona system-preamble, prepended ahead of the input */
  personaPreamble?: string
  /** optional document-skill instruction block — outermost when present */
  docSkillPrompt?: string
}): TurnRequest {
  const normalizedMode = normalizeMode(mode)
  const compactContext = buildCompactContext(summary, persistedMessages)
  const parameterInputs = buildParameterInputs(userDocs, {
    mode: normalizedMode,
    compactContext,
    ontology,
  })

  const targetAgentRid =
    normalizedMode === THINKING_MODE ? agents.thinking : agents.primary
  const agentVersion =
    pinnedAgentRid === targetAgentRid && pinnedAgentVersion?.trim()
      ? pinnedAgentVersion
      : null

  // Preambles frame the turn; document scope (parameterInputs) stays
  // orthogonal. Stacking order: doc-skill (structure) → persona (lens) →
  // input. Sources still win — both preambles carry that clause.
  const baseInput =
    normalizedMode === THINKING_MODE
      ? userInput.trim()
      : wrapRegularModePrompt(compactContext, userInput)

  return {
    agentRid: targetAgentRid,
    agentVersion,
    userInput: withPreamble(docSkillPrompt, withPreamble(personaPreamble, baseInput)),
    parameterInputs,
    compactContext,
  }
}

/* ------------------------------------------------------------------ */
/* Thinking-trace summarization (high-level only)                       */
/* ------------------------------------------------------------------ */

/** Raw AIP SessionTrace shape (platform openapi AipAgents.SessionTrace). */
export interface RawSessionTrace {
  id?: string
  status?: string
  toolCallGroups?: {
    toolCalls?: {
      toolMetadata?: { name?: string; type?: string }
      input?: { thought?: string; inputs?: Record<string, unknown> }
      output?: unknown
    }[]
  }[]
}

export interface TraceStep {
  id: string
  kind: "search" | "read" | "analyze" | "tool"
  label: string
  detail?: string
}

const THOUGHT_LIMIT = 160

function traceKindFor(toolName: string): TraceStep["kind"] {
  const name = toolName.toLowerCase()
  if (name.includes("query") || name.includes("search") || name.includes("semantic")) {
    return "search"
  }
  if (name.includes("document") || name.includes("retriev") || name.includes("media")) {
    return "read"
  }
  if (name.includes("calc") || name.includes("code") || name.includes("transform")) {
    return "analyze"
  }
  return "tool"
}

function cleanThought(thought: string | undefined): string | undefined {
  const text = (thought ?? "").replace(/\s+/g, " ").trim()
  if (!text) return undefined
  return text.length > THOUGHT_LIMIT ? `${text.slice(0, THOUGHT_LIMIT - 1)}…` : text
}

/**
 * Collapse a raw AIP session trace into high-level steps for the thinking
 * indicator. Deliberately surfaces ONLY the tool name and the agent's own
 * one-line "thought" — never tool inputs/outputs (individual fetches, RIDs,
 * query payloads). Consecutive calls to the same tool collapse into one step
 * with a ×N counter.
 */
export function summarizeTrace(trace: RawSessionTrace | null | undefined): TraceStep[] {
  if (!trace?.toolCallGroups) return []
  const steps: TraceStep[] = []
  let previous: { name: string; count: number; step: TraceStep } | null = null

  for (const group of trace.toolCallGroups) {
    for (const call of group.toolCalls ?? []) {
      const name = (call.toolMetadata?.name ?? "").trim() || "Working"
      const detail = cleanThought(call.input?.thought)
      if (previous && previous.name === name) {
        previous.count += 1
        previous.step.label = `${name} ×${previous.count}`
        // keep the most recent thought as the step detail
        if (detail) previous.step.detail = detail
        continue
      }
      const step: TraceStep = {
        id: `trace-${steps.length}`,
        kind: traceKindFor(name),
        label: name,
        ...(detail ? { detail } : {}),
      }
      steps.push(step)
      previous = { name, count: 1, step }
    }
  }
  return steps
}

/* ------------------------------------------------------------------ */
/* Stream error sentinel (matches PoC protocol)                         */
/* ------------------------------------------------------------------ */

export const STREAM_ERROR_PREFIX = "__orbit_stream_error__:"

export interface StreamErrorPayload {
  __error: true
  type: "context_exceeded" | "error"
  title: string
  message: string
  raw?: string
}

export function buildStreamErrorPayload(errorText: string): StreamErrorPayload {
  const normalized = errorText.toLowerCase()
  if (
    normalized.includes("contextsizeexceeded") ||
    normalized.includes("contextwindowexceeded")
  ) {
    return {
      __error: true,
      type: "context_exceeded",
      title: "Conversation limit reached",
      message:
        "This response exceeded the available model context window. Please try again.",
      raw: errorText,
    }
  }
  return {
    __error: true,
    type: "error",
    title: "We couldn't finish that response",
    message:
      "Something went wrong while generating the answer. Please try again.",
    raw: errorText,
  }
}

export function encodeStreamError(errorText: string): string {
  return `${STREAM_ERROR_PREFIX}${JSON.stringify(buildStreamErrorPayload(errorText))}`
}

export function parseStreamError(text: string): StreamErrorPayload | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(STREAM_ERROR_PREFIX)) return null
  try {
    return JSON.parse(trimmed.slice(STREAM_ERROR_PREFIX.length))
  } catch {
    return {
      __error: true,
      type: "error",
      title: "We couldn't finish that response",
      message: trimmed.slice(STREAM_ERROR_PREFIX.length),
    }
  }
}
