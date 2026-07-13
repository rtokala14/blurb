# Document Generation & Editing — implementation plan

**Status:** PRs 1–3 built and live-verified (generation, editing, exports,
save-to-library). PR 4 (sheets/decks, official brand assets) remains open.
**Owner:** Orbit Docs
**Audience:** whoever picks up the build — this is the complete spec.
**Depends on:** the personas feature (`docs/PERSONAS.md`) — skill packs compose
with personas at the same injection seam.

**Implementation notes (deviations from the plan below):**
- Whole-document revisions run through the refine query (like section edits)
  rather than a fresh generation turn — simpler, keeps chat history clean.
  Revisit if long documents hit refine limits.
- Artifacts are re-derived from the persisted transcript on every load (the
  assistant message IS the envelope), so base drafts survive reloads and
  devices without localStorage; only local edit rounds are browser-bound.
- The parser also strips leading agent chatter ("Final Answer:", "Let me…")
  ahead of the first heading, and tolerates blank-separated list items —
  both observed in live output.

## What this is

Users can already *ask about* their documents. This feature lets them *produce*
documents: grounded, professionally formatted, Jacobs-branded deliverables —
drafted by the agent inside a chat session, reviewed and edited in the Studio
panel, and exported (or saved back to the Library) as real `.docx`/`.pdf`
files.

Two halves, shipped together because neither is useful alone:

1. **Generation** — `/doc` in the composer (the demo slash command goes live)
   kicks off a generation turn. The agent is given a **document skill pack**
   (structure contract, register, formatting rules, anti-patterns for that
   document type), the session's persona if one is attached, and the session's
   document scope for grounding. It emits a structured draft with citations.
2. **Editing** — the draft opens in the Studio panel. The user asks for
   section-level AI edits (backed by the refine agent that is already live),
   reviews them as tracked changes with accept/reject, makes small manual
   fixes, and exports — every export pixel-identical in branding because
   styling is deterministic, not model-generated.

## The core principle: content ≠ presentation

The single most important design decision, and the reason the output will look
professional every time:

> **The agent produces content and semantic structure. It never produces
> styling.** Colors, fonts, spacing, cover pages, headers/footers, table
> styles all come from one deterministic brand module that the renderers
> apply. The model cannot make an ugly document because the model is never
> asked a visual question.

This is the same separation the personas feature made between *what the agent
knows* (documents) and *how it reads them* (persona). Here: *what the document
says* (agent) vs. *how it looks* (brand module).

Consequences:

- A skill pack tells the agent "a Technical Memo has these sections in this
  order, tables for these things, this register" — never "use blue headings."
- Renderers (`docx`, `jspdf`) are pure functions `DocModel → file`. Golden
  tests can assert the exact brand hex appears in the docx XML.
- When Jacobs brand/marketing hands us the official brand guide, we swap one
  module and every past and future export updates. Per the request, **v1 uses
  the app theme as the brand source** ("according to jacobs theme for now").

## What exists today (inventory)

Already real (live against the tenant):

- **Agent turns** — `streamingContinue` returns markdown with `<source>`
  citation tags; the persona preamble seam in `lib/foundry/turn.ts`
  (`prepareTurnRequest`) prepends instruction blocks to any turn.
- **Refine agent** — `POST /api/orbit/refine` executes the ontology refining
  query (`dgiiDocAiRefiningAgent`); verified live (5.4 s formal rewrite). This
  becomes the section-edit engine.
- **File rendering** — `lib/export-session.ts` already generates real
  Word/PDF/markdown client-side (`docx`, `jspdf` deps installed) with a
  minimal markdown→paragraph converter. It is transcript-shaped and
  unbranded; the new renderers generalize it.
- **Upload path** — quota-checked, duplicate-guarded upload to the mediaset +
  `create-orbit-docs-list` action. "Save to Library" reuses it verbatim.
- **Personas** — 7 discipline lenses that compose with skill packs (see
  "Composition" below).

Demo-only (the Studio, currently simulated):

- `components/studio/{studio-panel,doc-editor,sheet-editor,deck-editor}.tsx` —
  a complete UI shell: header with sources/versions menu, progressive-reveal
  drafting animation, AI-edit bar, tracked-change accept/reject on a
  **hardcoded** document. The interaction design is right; the data layer
  underneath it is what this plan builds.
- `Artifact` type + store (`artifacts`, `addArtifact`, `updateArtifact`,
  `setOpenArtifact`) — demo-seeded, no persistence, `content` not modeled.
- `/doc`, `/sheet`, `/deck` slash commands in the composer — wired to the
  simulation only.

Missing entirely: a document content model, a structured-output envelope +
parser, a brand module, branded renderers, live generation/edit wiring,
artifact persistence, and `xlsx`/`pptx` libraries (sheets and decks are
explicitly **out of v1 scope** — see Phasing).

## Architecture

```
 composer /doc ──► generation turn (streamingContinue)
                     prompt = skill pack + persona? + brief + scope docs
                          │  markdown envelope, streamed
                          ▼
                   envelope parser ──► DocModel (typed blocks + citations)
                          │                     │
            ┌─────────────┤                     │ every version kept
            ▼             ▼                     ▼
     Studio editor   branded renderers    version history
     (live React     docx / pdf ◄── lib/brand/jacobs.ts
      blocks,        (deterministic)
      tracked edits)
            │
            ├── section edit ──► /api/orbit/refine ──► parsed block(s)
            │                     (tracked change: accept / reject)
            └── Save to Library ──► existing upload path (quota, dedupe)
```

### 1. DocModel — the typed document (`lib/docgen/model.ts`, pure)

The single source of truth for a draft. Everything renders from it: the Studio
editor, the docx renderer, the pdf renderer, and the markdown fallback.

```ts
export interface DocMeta {
  title: string
  docType: DocTypeId          // which skill pack produced it
  subtitle?: string
  project?: string            // free text, e.g. contract/package reference
  preparedFor?: string
  revision: string            // "Rev A" — bumped on accepted edit rounds
  date: string                // ISO, set client-side, never by the model
}

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; id: string }
  | { kind: "paragraph"; runs: InlineRun[]; id: string }
  | { kind: "bullets" | "numbered"; items: InlineRun[][]; id: string }
  | { kind: "table"; caption?: string; header: string[]; rows: string[][]; id: string }
  | { kind: "callout"; tone: "note" | "risk" | "action"; runs: InlineRun[]; id: string }
  | { kind: "pageBreak"; id: string }

export type InlineRun =
  | { t: "text"; text: string; bold?: boolean; italic?: boolean }
  | { t: "cite"; n: number }   // reference into DocModel.citations

export interface DocModel {
  meta: DocMeta
  blocks: Block[]
  citations: Citation[]        // same shape the chat already uses
}
```

Deliberately small. No fonts, no colors, no widths — presentation lives in the
brand module. `id`s are client-generated stable keys so tracked changes and
React reconciliation address blocks, not indexes.

### 2. Output envelope + parser (`lib/docgen/parse.ts`, pure)

The generation prompt instructs the agent to answer **only** with:

````
```orbit-doc
{"title": "...", "docType": "technical-memo", "subtitle": "...", "project": "..."}
```

# 1. Purpose
Body markdown… <source …>…</source> citations exactly as in chat.

> [!risk] Callouts use GitHub-alert syntax with our tones.

| tables | as | GFM |
````

- Fenced `orbit-doc` JSON header → `DocMeta` (validated; unknown keys
  dropped; `date`/`revision` always set client-side).
- Markdown body → blocks, reusing the tokenizer patterns already proven in
  `lib/export-session.ts` (headings, bullets, bold) extended with GFM tables,
  numbered lists, and `> [!note|risk|action]` callouts.
- `<source>` tags → lifted out of text into `citations[]`, replaced with
  `{t:"cite"}` runs — identical to how the chat pipeline handles them today.

**Fallback is mandatory:** if the envelope is missing or malformed, the entire
output is parsed as plain markdown into a valid DocModel (title = first
heading or the brief). Generation must never lose content or show the user a
parse error. A `parseWarnings[]` field lets the Studio show a subtle "draft
imported loosely" hint.

Parser is pure and heavily unit-tested (golden envelopes, malformed inputs,
citation lifting, callout tones, table edge cases).

### 3. Brand module (`lib/brand/jacobs.ts`, pure)

One file owns every visual decision, sourced from the app theme
(`app/globals.css`). Documents need sRGB hex, so the oklch tokens are
converted once and pinned here (values below computed from the current
theme):

| Token            | Theme source                       | Hex       | Used for                             |
| ---------------- | ---------------------------------- | --------- | ------------------------------------ |
| `primary`        | `--primary oklch(0.45 0.13 255)`   | `#17559b` | H1/H2, cover band, table header fill |
| `primaryTint`    | `--accent oklch(0.94 0.02 250)`    | `#e2edf8` | callout fills, zebra rows            |
| `ink`            | `--foreground oklch(0.18 …)`       | `#0a121c` | body text                            |
| `inkMuted`       | `--muted-foreground oklch(0.5 …)`  | `#5c646f` | captions, footer, meta               |
| `hairline`       | `--border oklch(0.912 …)`          | `#d9dfe5` | table borders, rules                 |
| `accentTeal`     | `--chart-2 oklch(0.65 0.11 220)`   | `#249ebd` | secondary accents only               |
| `risk`           | `--destructive`                    | `#d4453a` | risk callout edge                    |

Plus, in the same module:

- **Typography** — v1 uses **Arial** (docx) / **helvetica** (jspdf): licensed
  everywhere, metric-safe, zero embedding work. The official Jacobs typeface
  is a one-line swap here when brand supplies it. Scale: title 28/H1 16/H2
  13/body 10 pt, 1.15 line height, 6 pt paragraph spacing.
- **Cover page spec** — full-width primary band, document title, subtitle,
  project reference, prepared-for, date + revision, and a text wordmark
  ("**Jacobs** · Orbit Docs") until a logo asset is provided (see Open
  questions).
- **Header/footer spec** — header: title left, project right, hairline rule;
  footer: revision + date left, "Page X of Y" right, and the disclaimer line
  *"AI-assisted draft generated by Orbit Docs — verify citations before
  external use"* in `inkMuted` 7 pt. Non-negotiable in v1: honest labeling of
  AI drafts is an enterprise requirement, not a style choice.
- **Table style** — primary-filled header row with white text, hairline body
  borders, `primaryTint` zebra striping, left-aligned text / right-aligned
  numerics.
- **Callout style** — 3 pt left edge (`primary`/`risk`/`accentTeal` by tone),
  `primaryTint` fill, bold lead-in ("Note:", "Risk:", "Action:").

### 4. Renderers (`lib/docgen/render-docx.ts`, `render-pdf.ts`, pure)

`(model: DocModel) → Blob`, client-side, using the already-installed `docx`
and `jspdf`. They generalize what `lib/export-session.ts` proves works, and
add: cover page, running headers/footers with page numbers, brand-styled
tables and callouts, superscript citation references, and an automatic
**References** section rendered from `citations[]` (doc name + pages — the
same fields chat citations carry).

Markdown export comes free (serialize the DocModel back to the envelope body)
and doubles as the persistence format.

`export-session.ts` is left alone in this phase; a later cleanup can re-base
transcript export on the brand module so exported chats match.

### 5. Document skill packs (`lib/docgen/skills.ts`, pure — data, like personas)

A **skill pack** is to a *document type* what a persona is to a *discipline*:
a curated, version-controlled instruction block. Shape mirrors
`lib/personas.ts` deliberately:

```ts
export interface DocSkill {
  id: DocTypeId
  name: string                 // "Technical Memo"
  icon: string                 // allow-listed lucide name
  summary: string              // one line for the picker
  structure: string[]          // ordered required sections — the contract
  guidance: string             // register, density, tables to prefer, length budget
  antiPatterns: string[]       // "no marketing language", "never invent clause numbers"…
  briefPlaceholder: string     // composer hint after type selection
}
```

`buildDocSkillPrompt(skill)` compiles this plus the envelope specification and
the grounding rules into the turn's instruction block, capped like
`PERSONA_PREAMBLE_MAX`. The grounding clause is strict and shared across all
packs: *every factual claim must carry a `<source>` citation from the scoped
documents; where the scope is silent, say so in a `note` callout rather than
inventing content; placeholders like `[TO CONFIRM: …]` are required for
unknowns (dates, names, values).* A generated document that silently invents
facts is worse than no feature — this clause is the safety core of v1.

**Seed set — 7 document types** (full seed data lands with PR 1; each ~40
lines, authored the way the personas were):

1. **Technical Memo** — purpose / background / analysis / recommendation;
   conditional register; every recommendation cites its basis.
2. **Executive Brief** — one-page discipline: situation, 3–5 findings, asks;
   numbers in tables, never prose-buried; no jargon anti-pattern.
3. **Meeting Minutes** — attendees, decisions, actions table (owner / due /
   status); terse past tense; no interpretation beyond what was said.
4. **RFI Response** — restate the question verbatim, response, basis with
   clause/drawing citations, impact statement (cost/schedule/none);
   anti-pattern: answering the question you wish was asked.
5. **Document Review Report** — submittal/deliverable review: summary verdict
   table (item / status / comment class), detailed comments keyed to page or
   section, REJECTED/RESUBMIT language rules (pairs naturally with the QA/QC
   persona).
6. **Progress Report** — period summary, progress vs. plan table, risks with
   owner + mitigation, look-ahead; traffic-light words only when backed by a
   cited number.
7. **Proposal Section** — win-theme-aware but evidence-first; compliance with
   the stated requirement structure; anti-pattern: unverifiable superlatives
   (composes with the Proposals persona).

### Composition with personas

Skill pack and persona occupy the same seam (`prepareTurnRequest`) and stack:

```
<doc-skill>   … how to write THIS KIND of document …  </doc-skill>
<persona>     … how THIS DISCIPLINE reads/writes …    </persona>
… grounding context + user brief …
```

Skill defines the skeleton; persona flavors vocabulary and what gets flagged.
Document Review Report × QA/QC persona is the flagship combination —
exactly the A/B pair that already proved personas work. Combined budget is
enforced (skill + persona ≤ 8 KB) with skill taking precedence on truncation,
since structure matters more than flavor.

### 6. Generation flow (server + client)

- Composer: `/doc` opens the type picker (7 skill packs, icons + summaries —
  same visual grammar as the persona picker), then a one-line brief. Sends a
  normal `continue` turn with `docSkillId` + brief; requires a non-empty
  document scope (generation without grounding is refused client-side with a
  pointed message, not a silent bad draft).
- Server: `runSessionTurn` gains `docSkillId` (exactly like `personaId`);
  `prepareTurnRequest` prepends the compiled skill prompt. **No new Foundry
  surface** — same agents, same session, same trace machinery. Thinking mode
  composes for research-heavy documents; the thinking-trace summary shows in
  the Studio header while drafting.
- Client: the streamed markdown is parsed incrementally — completed blocks
  render as they arrive, replacing the demo's fake progressive reveal with
  the real thing. The turn is also persisted as a normal assistant message
  (collapsed to an artifact card in the chat, like the demo's cards), so run
  recovery, branching, and history all keep working with zero special cases.
- The final parse produces version 1 of the artifact.

### 7. Editing loop

Three tiers, cheapest first:

1. **Manual block edits** — click a paragraph/heading/list to edit its
   markdown source inline (textarea swap, `⌘↵` to commit). No agent, no
   latency. Table cells edit in place. This is v1's "direct manipulation";
   a rich-text toolbar is explicitly out of scope (the demo toolbar stays a
   placeholder or is removed).
2. **Section AI edit** — select a block (or a heading = its whole section),
   type an instruction in the existing AI-edit bar. Calls
   `/api/orbit/refine` with `toRefine` = the section's markdown +
   `refineRequest` = instruction (+ compact doc context). Response is parsed
   back into blocks and presented as a **tracked change** — old blocks
   struck, new highlighted, Accept/Reject — productionizing the interaction
   the demo `doc-editor` already prototypes. Refine is a query, not a
   session turn: fast, no chat pollution.
3. **Whole-doc revision** — an edit instruction with no selection runs a full
   generation turn seeded with the current document serialized into the
   prompt ("revise, preserve structure and citations"), producing a new
   version with a block-level diff view.

**Versioning:** every accepted edit round appends `{model, summary, at}` to
the artifact's version list; the Studio versions menu (already in the UI)
lists them with one-click restore. Version list capped (keep 20).

### 8. Persistence & "Save to Library"

- **v1: client-side.** Artifacts (DocModel + versions) live in
  `localStorage` keyed by session — the exact pattern shipping for session
  personas (`orbit.session-personas`), sized fine for capped versions.
  Honest limitation, stated in UI copy: drafts are per-browser until saved.
- **Save to Library** makes it durable the *right* way with zero new Foundry
  surface: render to docx → `File` → the existing upload path (quota
  reservation, duplicate-name 409 with the friendly message, index-status
  polling). The saved document is then a first-class OrbitDocsList row —
  indexed, scopeable, visible in admin census. The generated → grounding
  loop closes: teams can generate a review report, save it, and query it
  next week.
- **v2 (Tier 2, needs Foundry-side change, out of scope now):** an
  `OrbitArtifact` ontology object (docModel JSON, sessionRid, versions,
  owner) for cross-device drafts and admin analytics on generation usage —
  same shape as the personas Tier-2 note, to be batched into the same
  ontology-change request.

### 9. UI wiring (Studio goes live)

Keep the demo Studio's information design — it is right — and replace its
simulation organs:

- `studio-panel.tsx`: real status from the streaming turn; sources menu lists
  the session's actual scope docs; versions menu reads the real version list;
  add **Export** (docx / pdf / markdown via the new renderers) and **Save to
  Library** actions to the header.
- `doc-editor.tsx`: rendered from `DocModel` blocks instead of the hardcoded
  `sections` array; block components for each `Block` kind styled with the
  same theme tokens the exports use (screen ≈ print); tracked-change UI
  generalized from the existing insertion prototype; citation runs get the
  chat's citation popover.
- Demo mode (`live === false`) keeps the current simulation untouched — same
  rule as everywhere else in the app.
- `sheet-editor.tsx` / `deck-editor.tsx` remain demo-only; `/sheet` and
  `/deck` are hidden behind `live === false` until Phase B.

### 10. Quota & admin

Generation turns are ordinary agent turns (already covered by session-level
behavior); Save to Library consumes upload quota (already enforced, friendly
429). No new limits in v1. Artifact counts join the admin overview later,
with the v2 ontology object — nothing to build now.

## Phasing / PR plan

- **PR 1 — foundations (pure, no behavior change).** `lib/brand/jacobs.ts`,
  `lib/docgen/{model,parse,skills}.ts` + 7 seed skill packs,
  `render-docx.ts`/`render-pdf.ts`. Bun tests: parser goldens + malformed
  fallback, skill-prompt compilation + budget, renderer smoke (brand hex
  present in docx XML, pdf page count, references section). Mirrors the
  personas PR 1 exactly.
- **PR 2 — live generation.** `docSkillId` through
  `continue`→`runSessionTurn`→`prepareTurnRequest`; composer type picker +
  brief; incremental parse-render into the Studio; artifact card in chat;
  localStorage persistence; Export actions. Live A/B smoke: same brief with
  and without the skill pack (the personas-style proof).
- **PR 3 — editing + save.** Manual block edits, refine-backed tracked
  changes, whole-doc revision, versions/restore, Save to Library through the
  upload path (verify quota + dedupe fire), disclaimer footer verified in
  exports.
- **PR 4 — later, on request.** Sheets (`exceljs` — writes real styled
  `.xlsx`; SheetJS community edition has no styling) and decks (`pptxgenjs`)
  with their own skill packs and brand mappings; transcript-export re-based
  on the brand module; v2 ontology persistence.

## Testing

- Unit (bun): parser (envelope, fallback, citations, callouts, tables),
  brand token integrity (hex format, contrast sanity for text-on-primary),
  skill prompt compilation (structure contract present, cap enforced,
  persona composition order), renderer smoke as above.
- Live smoke (extend `scripts/foundry-smoke.mjs` pattern): generate a
  Document Review Report against a scoped WIR doc — assert envelope parses,
  ≥1 citation survives to the References section, refine edit round-trips a
  section.
- Manual/Playwright: `/doc` → draft streams block-by-block → section edit →
  accept → export docx → save to Library → uploaded doc appears with quota
  decremented.

## Open questions (non-blocking; v1 answers chosen)

1. **Logo asset** — need an approved SVG/PNG from Jacobs brand for cover +
   header. v1 ships the text wordmark; slot is reserved in the brand module.
2. **Official brand palette/typeface** — v1 derives from the app theme per
   the request; when the brand guide arrives it's a one-module swap.
3. **Templates from real Jacobs deliverables** — the 7 seed packs are written
   from AEC convention; a pass with discipline leads (same review loop as
   personas) will sharpen structure contracts. Seed structure makes that a
   data-only change.
4. **Sheets/decks priority** — parked in PR 4 pending demand; doc/report is
   the enterprise 80%.
