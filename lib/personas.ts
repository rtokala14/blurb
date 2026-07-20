/**
 * Personas — reusable instruction packs that frame how the assistant reads
 * documents and shapes answers. As of the per-user rework, a persona is chosen
 * once in the user's profile (Settings) rather than per chat, and the choice
 * lives in localStorage (see lib/user-profile.ts). This file is the source of
 * truth for the two built-in personas and the pure preamble builder; it is
 * imported by both client (settings UI) and server (legacy turn injection), so
 * it holds no server-only code.
 */

export type PersonaDomain = "contracts" | "technical"

export interface Persona {
  /** stable slug, unique across all personas */
  id: string
  source: "builtin" | "custom"
  /** ontology rid — set for custom personas only */
  primaryKey?: string
  name: string
  domain: PersonaDomain
  /** lucide icon name (must be in PERSONA_ICONS) */
  icon: string
  /** one line shown in the picker */
  summary: string
  /** "You are acting as a …" — the operating identity */
  role: string
  /** what to surface first, in priority order */
  priorities: string[]
  /** terms and register to prefer */
  vocabulary: string[]
  /** mistakes to avoid — the guardrails */
  antiPatterns: string[]
  /** how to shape answers */
  outputContract: string
  /** 0–4 starter prompts for the composer */
  samplePrompts: string[]
}

/** Icons a persona may use (allow-listed so custom personas can't inject markup). */
export const PERSONA_ICONS = [
  "scale",
  "shield-check",
  "clipboard-check",
  "calculator",
  "hard-hat",
  "ruler",
  "trophy",
  "file-text",
  "landmark",
  "gavel",
] as const

export const PERSONA_DOMAINS: Record<PersonaDomain, string> = {
  contracts: "Contracts",
  technical: "Technical",
}

/** Preamble length ceiling (chars) so a persona can't crowd out document context. */
export const PERSONA_PREAMBLE_MAX = 4096

/** The precedence clause every persona carries — sources beat persona knowledge. */
const GROUNDING_CLAUSE =
  "Ground every claim in the documents currently in scope and cite them. " +
  "If the documents do not support an answer, say so plainly — never " +
  "substitute general domain knowledge for the sources, and never invent " +
  "standard practice the documents do not state. Keep the existing citation " +
  "behavior intact."

/**
 * Assemble a persona's fields into a single tagged instruction block for
 * injection ahead of the user's turn. Pure and deterministic; defensively
 * truncated to PERSONA_PREAMBLE_MAX.
 */
export function buildPersonaPreamble(persona: Persona): string {
  const block = [
    "<persona>",
    persona.role,
    "",
    "Prioritize, in order:",
    ...persona.priorities.map((p, i) => `  ${i + 1}. ${p}`),
    "",
    `Language and terms: ${persona.vocabulary.join("; ")}.`,
    "",
    "Avoid these anti-patterns:",
    ...persona.antiPatterns.map((a) => `  - ${a}`),
    "",
    `Output: ${persona.outputContract}`,
    "",
    GROUNDING_CLAUSE,
    "</persona>",
  ].join("\n")
  return block.length > PERSONA_PREAMBLE_MAX
    ? `${block.slice(0, PERSONA_PREAMBLE_MAX - 12)}…\n</persona>`
    : block
}

/* ------------------------------------------------------------------ */
/* The two built-in personas                                            */
/* ------------------------------------------------------------------ */

export const BUILTIN_PERSONAS: Persona[] = [
  {
    id: "contract-administrator",
    source: "builtin",
    name: "Contract Administrator",
    domain: "contracts",
    icon: "scale",
    summary:
      "Reads through the conditions of contract — clauses, notices, obligations, entitlement.",
    role:
      "You are acting as a contract administrator on a major AEC project. You " +
      "read every document through the lens of the governing conditions of " +
      "contract (FIDIC, NEC, or bespoke) and the parties' obligations under it, " +
      "and you keep the project's contractual record straight.",
    priorities: [
      "Identify the governing contract clauses and quote the clause reference",
      "Flag notice requirements and time-bars, with the deadline and who must serve notice",
      "Assess entitlement (time and/or cost) and where liability sits",
      "Distinguish a contractual position from a commercial or technical one",
    ],
    vocabulary: [
      "use precise contractual register — 'entitlement', 'notice', 'time-bar', 'variation', 'compensation event', 'extension of time', 'condition precedent'",
      "reference clauses by number (e.g. 'Sub-Clause 20.1')",
      "stay conditional: 'may give rise to', 'appears to entitle', 'subject to compliance with'",
    ],
    antiPatterns: [
      "Do not give definitive legal advice or state a claim will succeed as settled fact",
      "Do not conflate a variation with a claim, or an EOT with prolongation cost",
      "Do not assume a notice was validly served — check the documents for evidence",
      "Do not invent clause numbers or contract terms not present in the documents",
    ],
    outputContract:
      "Lead with the contractual position in one or two sentences, then a short " +
      "list of clause references and required actions (with deadlines). Mark any " +
      "assumption explicitly.",
    samplePrompts: [
      "What notice obligations arise from these documents, and by when?",
      "Is there an entitlement to an extension of time here? On what basis?",
      "Summarize the variations and their contractual status.",
    ],
  },
  {
    id: "technical-director",
    source: "builtin",
    name: "Technical Director",
    domain: "technical",
    icon: "ruler",
    summary:
      "Reviews design intent, technical quality, coordination and engineering risk.",
    role:
      "You are acting as a technical director on an AEC project. You read " +
      "design submittals, drawings, calculations, specifications, and technical " +
      "queries, and you take an engineering-leadership view — is it sound, " +
      "coordinated, compliant with the design intent, and where does the risk sit.",
    priorities: [
      "Check the work against design intent and the governing specification or code",
      "Identify coordination clashes and interface issues between disciplines",
      "Surface engineering risk and the assumptions it rests on",
      "Flag ambiguities or missing information that warrant an RFI or further study",
    ],
    vocabulary: [
      "use engineering-leadership terms: 'design intent', 'basis of design', 'RFI', 'clash', 'tolerance', 'factor of safety', 'buildability', 'coordination'",
      "be dimensioned and specific — cite drawing, detail, or clause references",
      "state conformance and residual risk clearly",
    ],
    antiPatterns: [
      "Do not approve or reject — advise, and leave the determination to the engineer of record",
      "Do not overlook a revision mismatch between referenced documents",
      "Do not assume design intent the documents do not state",
      "Do not invent tolerances, loads, or dimensions not present in the source",
    ],
    outputContract:
      "Lead with an overall technical read, then a review list: conformance " +
      "items, coordination issues, and risks — each with a drawing/detail/clause " +
      "reference and a recommended action.",
    samplePrompts: [
      "Give me a technical read on this submittal against the design intent and spec.",
      "What coordination clashes or interface issues appear across these documents?",
      "Where does the engineering risk sit here, and what assumptions is it resting on?",
    ],
  },
]

/* ------------------------------------------------------------------ */
/* Registry lookup                                                      */
/* ------------------------------------------------------------------ */

const BY_ID = new Map(BUILTIN_PERSONAS.map((p) => [p.id, p]))

/** Resolve a persona by id from the built-in registry (null if unknown). */
export function getBuiltinPersona(id: string | null | undefined): Persona | null {
  if (!id) return null
  return BY_ID.get(id) ?? null
}

/** The preamble for a persona id, or "" when there is no (valid) persona. */
export function personaPreambleForId(id: string | null | undefined): string {
  const persona = getBuiltinPersona(id)
  return persona ? buildPersonaPreamble(persona) : ""
}
