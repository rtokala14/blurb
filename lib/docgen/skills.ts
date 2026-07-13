/**
 * Document skill packs — curated authoring instructions per document type,
 * the docgen counterpart of lib/personas.ts. A skill pack tells the agent
 * how to write THIS KIND of document (structure contract, register, tables,
 * anti-patterns); it never makes visual decisions — styling belongs to
 * lib/brand/jacobs.ts. See docs/DOC_GENERATION.md.
 *
 * Imported by both client (type picker) and server (turn injection) —
 * no server-only code.
 */

export interface DocSkill {
  /** stable slug — also DocMeta.docType */
  id: string
  name: string
  /** lucide icon name (allow-listed in the picker) */
  icon: string
  /** one line shown in the picker */
  summary: string
  /** ordered required sections — the structure contract */
  structure: string[]
  /** register, density, tables to prefer, length budget */
  guidance: string
  /** mistakes to avoid — the guardrails */
  antiPatterns: string[]
  /** composer hint once the type is selected */
  briefPlaceholder: string
}

/** Combined skill + persona instruction budget (chars). Skill wins on truncation. */
export const DOC_SKILL_PROMPT_MAX = 8192

/**
 * The output contract every pack shares: envelope format + grounding rules.
 * A generated document that silently invents facts is worse than no feature.
 */
const ENVELOPE_SPEC = `Return ONLY the document, in exactly this format — no preamble, no commentary after:

\`\`\`orbit-doc
{"title": "<document title>", "docType": "<docType>", "subtitle": "<optional>", "project": "<optional reference>"}
\`\`\`

Then the document body in markdown:
- Start the body directly with the first "##" heading — no introduction, no "Final Answer:", no commentary about your process.
- "#" / "##" / "###" headings for sections (numbered like "## 1. Purpose").
- GitHub-style tables for anything tabular.
- "> [!note] …", "> [!risk] …", "> [!action] …" for callouts.
- **bold** for emphasis; no other styling, no HTML, no horizontal rules.
- Never mention colors, fonts, or layout — formatting is applied downstream.`

const GROUNDING_RULES = `Grounding rules (mandatory):
- Every factual claim must carry a citation from the documents in scope, using the same <source> citation tags you normally use.
- Where the scoped documents are silent, say so in a "> [!note]" callout — never invent content, values, or standard practice.
- Use bracketed placeholders like [TO CONFIRM: recipient name] for required details the documents do not provide (dates, names, values).
- Do not fabricate document references, clause numbers, or drawing numbers.`

/**
 * Compile a skill pack into the turn's instruction block. The user's brief
 * is NOT embedded here — it travels as the turn input, so chat history and
 * persistence read naturally. Pure and deterministic; defensively truncated
 * so the skill (plus any persona) cannot crowd out document context.
 */
export function buildDocSkillPrompt(skill: DocSkill): string {
  const block = [
    "<doc-skill>",
    `You are drafting a professional ${skill.name} for Jacobs, an AEC consultancy.`,
    "The user's message below is the drafting brief.",
    "",
    "Required structure, in this order (rename section titles only if the brief demands it):",
    ...skill.structure.map((s, i) => `  ${i + 1}. ${s}`),
    "",
    skill.guidance,
    "",
    "Avoid these anti-patterns:",
    ...skill.antiPatterns.map((a) => `  - ${a}`),
    "",
    ENVELOPE_SPEC.replace("<docType>", skill.id),
    "",
    GROUNDING_RULES,
    "</doc-skill>",
  ].join("\n")
  return block.length > DOC_SKILL_PROMPT_MAX
    ? `${block.slice(0, DOC_SKILL_PROMPT_MAX - 1)}…`
    : block
}

/* ------------------------------------------------------------------ */
/* The seven built-in document skills                                    */
/* ------------------------------------------------------------------ */

export const DOC_SKILLS: DocSkill[] = [
  {
    id: "technical-memo",
    name: "Technical Memo",
    icon: "file-text",
    summary: "Purpose, background, analysis, recommendation — decision-ready.",
    structure: [
      "Purpose — one paragraph: the question this memo answers and for whom",
      "Background — the relevant facts from the source documents, cited",
      "Analysis — reasoned assessment, each step grounded in the sources",
      "Recommendation — numbered, actionable, each item citing its basis",
    ],
    guidance:
      "Conditional professional register ('the data indicates', 'we recommend'). " +
      "Dense but plain — a senior engineer should read it in five minutes. " +
      "Prefer a table wherever three or more comparable values appear. " +
      "Target 600–1000 words.",
    antiPatterns: [
      "Recommendations that do not trace back to a cited finding",
      "Marketing language or superlatives",
      "Burying the recommendation below unrelated detail",
      "Restating the entire source document instead of analyzing it",
    ],
    briefPlaceholder:
      "e.g. Assess the settlement readings in the monitoring report and recommend next steps",
  },
  {
    id: "executive-brief",
    name: "Executive Brief",
    icon: "briefcase",
    summary: "One page: situation, three to five findings, asks.",
    structure: [
      "Situation — two or three sentences of context",
      "Key findings — 3–5 findings, each one sentence plus a citation",
      "Numbers that matter — a single table of the decision-relevant figures",
      "Asks — what the executive is being asked to decide or note, numbered",
    ],
    guidance:
      "One-page discipline: under 400 words. Every number lives in the table, " +
      "never buried in prose. Plain business language a non-specialist reads " +
      "without a glossary.",
    antiPatterns: [
      "Discipline jargon or unexplained acronyms",
      "More than five findings — synthesize instead",
      "Hedged asks ('it might be worth considering…') — state the ask",
      "Numbers scattered through prose instead of the table",
    ],
    briefPlaceholder:
      "e.g. Brief the delivery director on the Q2 inspection outcomes across the WIR package",
  },
  {
    id: "meeting-minutes",
    name: "Meeting Minutes",
    icon: "clipboard-list",
    summary: "Attendees, decisions, actions table with owners and dates.",
    structure: [
      "Meeting details — subject, date, location [TO CONFIRM where unknown]",
      "Attendees — table of name, organization, role",
      "Decisions — numbered list of what was decided, cited to the record",
      "Actions — table of action, owner, due date, status",
      "Next meeting — date and expected agenda if stated",
    ],
    guidance:
      "Terse past tense ('It was agreed…', 'NOC confirmed…'). Record only what " +
      "the source states — minutes are evidence, not commentary. Every action " +
      "gets an owner, or [TO CONFIRM: owner].",
    antiPatterns: [
      "Interpretation or opinion beyond what was said",
      "Actions without owners or due dates",
      "Direct quotes unless the source records them verbatim",
      "Merging multiple decisions into one vague item",
    ],
    briefPlaceholder:
      "e.g. Draft minutes from the progress meeting notes in scope, actions table included",
  },
  {
    id: "rfi-response",
    name: "RFI Response",
    icon: "message-square-reply",
    summary: "Question restated, response, contractual basis, impact.",
    structure: [
      "RFI reference — number, subject, received date [TO CONFIRM where unknown]",
      "Question — the request restated verbatim from the source",
      "Response — the direct answer, unambiguous",
      "Basis — the clauses, drawings, or specifications relied on, cited precisely",
      "Impact — cost / schedule / none, stated explicitly",
    ],
    guidance:
      "Answer the question asked — nothing more. Formal contractual register. " +
      "Cite clause and drawing references exactly as the sources give them. " +
      "If the sources cannot support a complete answer, say which part is open.",
    antiPatterns: [
      "Answering the question you wish had been asked",
      "Inventing or approximating clause and drawing numbers",
      "Leaving the impact statement implicit",
      "Volunteering opinions on entitlement beyond the question",
    ],
    briefPlaceholder:
      "e.g. Respond to RFI-214 on waterproofing detail using the spec section in scope",
  },
  {
    id: "review-report",
    name: "Document Review Report",
    icon: "clipboard-check",
    summary: "Verdict table plus detailed comments keyed to the source.",
    structure: [
      "Scope of review — what was reviewed, against what criteria",
      "Summary verdict — table of item, status (Approved / Approved with comments / Revise and resubmit / Rejected), comment class",
      "Detailed comments — numbered, each keyed to a page or section of the reviewed document, cited",
      "Conditions — what must change before the next submission, numbered",
    ],
    guidance:
      "Use the formal review statuses exactly — never soften 'Rejected' to " +
      "'needs work'. Each comment states what is wrong, where, and what closure " +
      "looks like. Classify comments (technical / editorial / compliance).",
    antiPatterns: [
      "Vague comments without a location in the reviewed document",
      "Softening formal review statuses",
      "Comments that state a problem but not the closure criterion",
      "Repeating the same defect as multiple comments",
    ],
    briefPlaceholder:
      "e.g. Review the contractor's method statement in scope against the spec requirements",
  },
  {
    id: "progress-report",
    name: "Progress Report",
    icon: "trending-up",
    summary: "Period summary, progress vs plan, risks, look-ahead.",
    structure: [
      "Period summary — reporting window and one-paragraph overall position",
      "Progress against plan — table of area, planned, actual, variance",
      "Risks and issues — table of risk, owner, mitigation, movement since last period",
      "Look-ahead — the next period's key activities, numbered",
    ],
    guidance:
      "Neutral reporting register. A status word ('on track', 'behind') appears " +
      "only when a cited number backs it. Variances get an explanation or " +
      "[TO CONFIRM: reason]. Target 500–800 words plus tables.",
    antiPatterns: [
      "Traffic-light claims with no cited number behind them",
      "Hiding slippage in prose instead of the variance table",
      "Risks without owners or mitigations",
      "Copying last period's text where the sources show change",
    ],
    briefPlaceholder:
      "e.g. Monthly progress report from the site records in scope, June period",
  },
  {
    id: "proposal-section",
    name: "Proposal Section",
    icon: "trophy",
    summary: "Requirement-led bid writing — evidence first, no fluff.",
    structure: [
      "Requirement — the client requirement being answered, restated",
      "Our response — how it will be met, structured to mirror the requirement",
      "Evidence — cited past performance, methods, or data from the sources",
      "Compliance statement — explicit confirmation of what is and is not offered",
    ],
    guidance:
      "Confident but verifiable — every capability claim carries evidence from " +
      "the scoped documents. Mirror the client's own terminology from the " +
      "requirement. Benefits stated as outcomes, not adjectives.",
    antiPatterns: [
      "Unverifiable superlatives ('world-class', 'unrivalled')",
      "Boilerplate that ignores the stated requirement structure",
      "Claims with no cited evidence behind them",
      "Ambiguity about what is actually being offered",
    ],
    briefPlaceholder:
      "e.g. Draft the quality management section responding to schedule 4 requirements",
  },
]

export function getDocSkill(id: string | null | undefined): DocSkill | null {
  if (!id) return null
  return DOC_SKILLS.find((s) => s.id === id) ?? null
}
