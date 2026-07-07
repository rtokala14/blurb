import { uid } from "@/lib/store"
import type {
  ArtifactKind,
  Citation,
  Doc,
  ThinkingStep,
} from "@/lib/types"

export interface SimulatedResponse {
  thinking: ThinkingStep[]
  content: string
  citations: Citation[]
  artifact?: { kind: ArtifactKind; title: string }
}

const quotePool = [
  "Renewal terms require ninety (90) days prior written notice before the end of the then-current term.",
  "Aggregate spend for the trailing twelve months totaled $412,300, an increase of 18% year over year.",
  "Vendor commitments exceeding $100,000 in annual contract value require CFO approval prior to execution.",
  "Service credits accrue at 5% of monthly fees for each 0.1% below the availability commitment.",
  "All customer content is encrypted at rest using AES-256 and in transit via TLS 1.2 or higher.",
  "The parties agree that neither will solicit the other's personnel for a period of twelve (12) months.",
  "Quarterly business reviews shall be conducted with executive sponsors from both parties in attendance.",
  "Forecast assumes a 6% quarter-over-quarter increase in platform usage across enterprise workspaces.",
]

function titleFromPrompt(prompt: string, fallback: string): string {
  const cleaned = prompt
    .replace(/^(create|draft|write|build|make|generate)\s+(a|an|the)?\s*/i, "")
    .replace(/[.?!]+$/, "")
    .trim()
  if (!cleaned) return fallback
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1, 60)
}

function detectArtifact(prompt: string): { kind: ArtifactKind; title: string } | undefined {
  const p = prompt.toLowerCase()
  const wantsCreation =
    /\b(create|draft|write|build|make|generate|put together|prepare)\b/.test(p) ||
    p.startsWith("/doc") ||
    p.startsWith("/sheet") ||
    p.startsWith("/deck")
  if (!wantsCreation) return undefined
  if (p.startsWith("/deck") || /\b(deck|presentation|slides?|ppt|pitch)\b/.test(p))
    return { kind: "deck", title: titleFromPrompt(prompt, "New presentation") }
  if (
    p.startsWith("/sheet") ||
    /\b(spreadsheet|excel|xlsx?|model|table|tracker|budget sheet)\b/.test(p)
  )
    return { kind: "sheet", title: titleFromPrompt(prompt, "New spreadsheet") }
  if (
    p.startsWith("/doc") ||
    /\b(doc|document|memo|brief|summary doc|report|one[- ]pager|letter|proposal)\b/.test(p)
  )
    return { kind: "doc", title: titleFromPrompt(prompt, "New document") }
  return undefined
}

const artifactNouns: Record<ArtifactKind, string> = {
  doc: "document",
  sheet: "spreadsheet",
  deck: "presentation",
}

export function simulateResponse(
  prompt: string,
  scopeDocs: Doc[]
): SimulatedResponse {
  const artifact = detectArtifact(prompt)
  const cited = scopeDocs.filter((d) => d.status === "ready").slice(0, 3)

  const citations: Citation[] = cited.map((doc, i) => ({
    n: i + 1,
    docId: doc.id,
    page: Math.min(doc.pages, 3 + ((i * 7) % Math.max(doc.pages - 2, 1))),
    quote: quotePool[(prompt.length + i * 3) % quotePool.length],
  }))

  const thinking: ThinkingStep[] = [
    {
      id: uid("t"),
      kind: "plan",
      label: "Planning approach",
      detail: artifact
        ? `Outline the ${artifactNouns[artifact.kind]}, then ground each section in the selected sources.`
        : "Break the question into sub-queries and identify which sources should answer each.",
    },
    {
      id: uid("t"),
      kind: "search",
      label: `Searching ${scopeDocs.length} ${scopeDocs.length === 1 ? "document" : "documents"} in scope`,
      detail: `Query: “${prompt.slice(0, 64)}${prompt.length > 64 ? "…" : ""}”`,
      docIds: cited.map((d) => d.id),
    },
    ...cited.slice(0, 2).map((doc) => ({
      id: uid("t"),
      kind: "read" as const,
      label: `Reading ${doc.name}`,
      detail: `Focusing on the ${["most recent", "relevant", "key"][doc.name.length % 3]} sections`,
      docIds: [doc.id],
    })),
    {
      id: uid("t"),
      kind: "analyze",
      label: "Cross-referencing findings",
      detail: "Reconciling figures and terms across sources",
      docIds: cited.map((d) => d.id),
    },
    ...(artifact
      ? [
          {
            id: uid("t"),
            kind: "tool" as const,
            label: `Creating ${artifactNouns[artifact.kind]} “${artifact.title}”`,
            detail:
              artifact.kind === "deck"
                ? "Drafting slides with speaker notes and source references"
                : artifact.kind === "sheet"
                  ? "Building tabs, formulas, and a summary view"
                  : "Drafting sections with tracked AI insertions",
          },
        ]
      : [
          {
            id: uid("t"),
            kind: "synthesize" as const,
            label: "Composing grounded answer",
            detail: `${citations.length} passages selected for citation`,
          },
        ]),
  ]

  const src = (n: number) => (citations[n - 1] ? `⟦${n}⟧` : "")

  let content: string
  if (artifact) {
    const noun = artifactNouns[artifact.kind]
    content =
      `I've drafted **${artifact.title}** as a working ${noun}, grounded in the ${cited.length || "selected"} sources in scope.\n\n` +
      (artifact.kind === "deck"
        ? `The draft has 10 slides: an executive summary, three insight sections built from the source material ${src(1)}, and a closing asks slide. Speaker notes carry a source reference for every figure ${src(2)}.\n\n`
        : artifact.kind === "sheet"
          ? `It contains three tabs — inputs, model, and summary. Key drivers are pulled from the sources ${src(1)}, and each computed cell notes its assumption ${src(2)}.\n\n` : `It's organized into five sections, with the key obligations and figures pulled directly from the sources ${src(1)}${src(2) ? ` ${src(2)}` : ""}. AI-drafted passages are highlighted for your review.\n\n`) +
      `It's open in the Studio panel — you can review the generation live, ask me for edits, or refine sections yourself.`
  } else if (cited.length === 0) {
    content =
      `I don't have any indexed documents in scope for this session yet, so this answer is **not grounded in your library**.\n\n` +
      `Select folders or documents from the context panel on the left and I'll re-run the question against them — every claim will then carry an inline citation you can verify.`
  } else {
    content =
      `Here's what the ${cited.length === 1 ? "selected document shows" : `${cited.length} most relevant sources show`}:\n\n` +
      `**Key finding.** The strongest signal comes from ${shortName(cited[0])}: the governing terms set a clear constraint you'll want to act on this quarter ${src(1)}.\n\n` +
      (cited[1]
        ? `**Supporting data.** The figures in ${shortName(cited[1])} line up with that reading — the trailing-twelve-month trend is up materially ${src(2)}.\n\n`
        : "") +
      (cited[2]
        ? `**Policy check.** Note that ${shortName(cited[2])} adds an approval requirement that applies here ${src(3)}.\n\n`
        : "") +
      `- The notice window and thresholds are the binding constraints ${src(1)}\n` +
      `- Figures reconcile across sources with no material conflicts ${src(2) || src(1)}\n\n` +
      `Want me to draft this up as a document, model it in a spreadsheet, or turn it into slides?`
  }

  return { thinking, content, citations, artifact }
}

function shortName(doc: Doc): string {
  return `*${doc.name.replace(/\.[a-z]+$/i, "")}*`
}

/** Variation applied when the user hits “regenerate”. */
export function varyResponse(base: SimulatedResponse): SimulatedResponse {
  return {
    ...base,
    thinking: [
      {
        id: uid("t"),
        kind: "plan",
        label: "Reconsidering with a different emphasis",
        detail: "Weighting risks and exceptions more heavily this pass",
      },
      ...base.thinking.slice(1),
    ],
    content:
      `Taking another pass with more emphasis on risk:\n\n` +
      base.content.replace(/^Here's what/, "Re-reading the sources, here's what"),
  }
}
