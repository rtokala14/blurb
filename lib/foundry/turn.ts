/**
 * Pure turn-preparation logic for the v3 main agent. No I/O — unit-testable.
 *
 * The v3 pipeline has a single AIP Chatbot (no thinking mode) driven via the
 * platform Sessions API. It takes two READ_ONLY objectSet parameters:
 *   Files   — OrbitDocsDocMeta objects the agent may cite
 *   Folders — OrbitDocsFolderRegistry objects (first-party folder scoping —
 *             no client-side folder→file expansion needed)
 * Conversation continuity lives in the AIP session (sessionRid), which the
 * app stores per chat session and reuses across turns.
 */

export function normalizeTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) return "New chat"
  return normalized.slice(0, 200)
}

export interface TurnScope {
  documentIds: string[]
  folderIds: string[]
}

/** ObjectSet of the given type filtered to the given primary keys. */
function objectSetParam(
  ontology: string,
  objectType: string,
  pkField: string,
  ids: string[]
): Record<string, unknown> | undefined {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return undefined
  return {
    type: "objectSet",
    ontology,
    objectSet: {
      type: "filter",
      objectSet: { type: "base", objectType },
      where: { type: "in", field: pkField, value: unique },
    },
  }
}

/**
 * Build the agent's parameterInputs for one turn. Parameter names match the
 * agent's configuration exactly ("Files", "Folders" — verified via the
 * get-agent endpoint).
 */
export function buildParameterInputs(
  scope: TurnScope,
  ontology: string
): Record<string, unknown> {
  const parameterInputs: Record<string, unknown> = {}
  const files = objectSetParam(
    ontology,
    "OrbitDocsDocMeta",
    "documentId",
    scope.documentIds
  )
  const folders = objectSetParam(
    ontology,
    "OrbitDocsFolderRegistry",
    "folderId",
    scope.folderIds
  )
  if (files) parameterInputs.Files = files
  if (folders) parameterInputs.Folders = folders
  return parameterInputs
}

/** Prepend an instruction preamble ahead of the turn input (blank → unchanged). */
export function withPreamble(
  preamble: string | undefined,
  input: string
): string {
  const trimmed = (preamble ?? "").trim()
  return trimmed ? `${trimmed}\n\n${input}` : input
}

/**
 * Compose the final user input for a turn. Stacking order: doc-skill
 * (structure) → persona (lens) → input. Conversation continuity is handled
 * by the agent's own session (sessionRid), so no context wrapping here.
 */
export function composeTurnInput({
  userInput,
  personaPreamble,
  docSkillPrompt,
}: {
  userInput: string
  personaPreamble?: string
  docSkillPrompt?: string
}): string {
  return withPreamble(docSkillPrompt, withPreamble(personaPreamble, userInput.trim()))
}

/* ------------------------------------------------------------------ */
/* Session metadata prompts (LLM proxy)                                 */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Stream error sentinel (kept from the PoC wire protocol)              */
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
