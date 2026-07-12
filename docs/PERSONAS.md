# Personas — implementation plan

**Status:** proposed (design + seed data landed; wiring not yet built)
**Owner:** Orbit Docs
**Audience:** whoever picks up the build — this is the complete spec.

## What a persona is

A **persona** is an optional, reusable instruction pack a user attaches to a
chat session. It tells the AIP agent *who it is acting as* for that
conversation — the domain lens (contracts, compliance, QA/QC, cost, health &
safety…), the vocabulary and register to use, the structure answers should
take, and the mistakes to avoid. It does **not** change which documents are in
scope (that's the existing document/folder selection) and it does **not**
change which agent runs (primary vs. deep-research). It changes the *framing*
of every turn in the session.

Concretely: a persona contributes a **system preamble** that is prepended to
the user's input on every turn of the session, plus UI metadata (name, icon,
domain tag, sample prompts). Attaching "Contracts & Claims Advisor" to a
session scoped over a WIR package makes the agent read those documents as a
contracts specialist would — citing clauses, flagging notice deadlines,
staying in the conditional register a claims consultant uses — instead of
giving a generic summary.

This is deliberately a **prompt-layer** feature. Jacobs is an AEC consultancy;
the value is encoding *how a discipline lead reads a document* into something a
junior engineer can invoke in one click. No ontology model changes are
required for v1; personas are data, and the seed set ships in the repo.

## Why this design (and what it is not)

- **Not fine-tuned models, not separate agents.** Foundry AIP agents are
  shared infrastructure; we can't spin up seven. A persona is context we
  inject, so it works with the agents we already call.
- **Not RAG over a "persona knowledge base."** The guidance is small, curated,
  and hand-written by domain leads — it belongs in version control where it can
  be reviewed, diffed, and rolled back, not in a vector store.
- **Not a replacement for document scope.** Persona × documents is a matrix:
  the same contract read by the Contracts persona vs. the Commercial persona
  produces different answers. Keep them orthogonal.
- **Optional, always.** A session with no persona behaves exactly as today.

## The two storage tiers

### Tier 1 — built-in personas (ship in v1)

Seven curated personas live in `lib/personas.ts` as typed, version-controlled
data (see the seed set below). They need no backend: the client already knows
them, and the persona's `id` is all that has to travel to the server on a turn.
This is the entire v1 surface — usable the day it merges.

### Tier 2 — custom personas (fast-follow, ontology-backed)

Admins (and later, any user) create their own via a new `OrbitPersona`
ontology object, mirroring the `OrbitChatFolders` pattern we already shipped.
Everything Tier 1 needs from a persona is expressible as plain fields, so the
same `Persona` TypeScript type serves both; built-ins have `source: "builtin"`,
custom ones `source: "custom"` with a `primaryKey`.

`OrbitPersona` object (proposed — kebab-case api names, camelCase params, same
conventions as `create-orbit-chat-folders`):

| property | type | notes |
|---|---|---|
| `primaryKey_` | string | rid |
| `name` | string | ≤ 60 chars |
| `domain` | string | one of the domain tags (see type) |
| `icon` | string | lucide icon name (validated against an allow-list) |
| `summary` | string | one line shown in the picker |
| `systemPreamble` | string | the injected instruction block (≤ ~4 KB) |
| `samplePrompts` | string[] | 0–4 starter prompts |
| `createdBy` | string | normalized email (creator-only edit) |
| `isShared` | boolean | visible workspace-wide vs. private |
| `isDeleted` / `deletedAt` | boolean / ts | soft delete (nullable — JS filter) |
| `createdAt` / `updatedAt` | ts | |

Actions: `create-orbit-persona`, `edit-orbit-persona` (full-replay, like the
chat-folder edit), soft delete via `edit` setting `isDeleted`. This tier is
**out of scope for the first PR** — but the type and the injection seam are
built so Tier 2 is purely additive.

## Data model (TypeScript — the contract both tiers honor)

Lives in `lib/personas.ts`. Kept deliberately small and declarative so a
domain lead can review a persona as prose, and so `buildPersonaPreamble()`
(below) can assemble a consistent instruction block from the parts.

```ts
export type PersonaDomain =
  | "contracts" | "compliance" | "quality" | "commercial"
  | "safety" | "design" | "proposals"

export interface Persona {
  id: string                    // stable slug, e.g. "contracts-claims"
  source: "builtin" | "custom"
  primaryKey?: string           // set for custom (ontology rid)
  name: string
  domain: PersonaDomain
  icon: string                  // lucide icon name (allow-listed)
  summary: string               // one line for the picker
  /** the persona's operating brief — assembled into the preamble */
  role: string                  // "You are acting as a …"
  priorities: string[]          // what to surface first, in order
  vocabulary: string[]          // terms/register to prefer
  antiPatterns: string[]        // what NOT to do — the guardrails
  outputContract: string        // how to shape answers
  samplePrompts: string[]       // 0–4 starter prompts for the composer
}
```

`role`, `priorities`, `vocabulary`, `antiPatterns`, and `outputContract` are
separate fields (not one blob) so the assembled preamble is uniform across
personas and so custom personas can be built with a guided form rather than a
freeform textarea. `buildPersonaPreamble(persona)` renders them into a single
`<persona>…</persona>`-tagged block.

## How it plugs into a turn (the injection seam)

The chat turn is assembled in `lib/foundry/turn.ts → prepareTurnRequest()`.
Regular mode already wraps the user input with `wrapRegularModePrompt(context,
input)`; thinking mode passes the raw input. Personas add **one optional
parameter** that is prepended ahead of both:

1. `ChatSession` gains `personaId?: string | null` (like the existing
   `chatFolderId`), persisted on `OrbitDocsUserSessions` via a new nullable
   `personaId` property (or, to avoid an ontology change in v1, stored
   client-side + echoed on each `/continue` call — see "v1 shortcut" below).
2. `RunTurnParams` and `prepareTurnRequest()` take `personaPreamble?: string`.
3. In `prepareTurnRequest`, when a preamble is present it is prepended:
   - regular mode: `personaPreamble + "\n\n" + wrapRegularModePrompt(ctx, input)`
   - thinking mode: `personaPreamble + "\n\n" + input.trim()`
   The `parameterInputs` (document objectSet) are untouched — persona and
   scope stay orthogonal.
4. `runSessionTurn` resolves the session's `personaId` → `Persona` →
   `buildPersonaPreamble()` and passes it down. Resolution is pure and
   unit-testable; the built-in registry is a synchronous lookup, custom
   personas a cached ontology fetch.

**v1 shortcut (no ontology change):** the client sends `personaId` in the
`/continue` request body; the server maps it through the built-in registry and
injects the preamble for that turn. Session persistence of the persona choice
rides the existing session-scope sync (add `personaId` next to
`docsAttached`). This keeps the first PR to app code only. Tier 2 later adds
the `personaId` column so the choice survives a server-side transcript replay
(run recovery) without the client re-sending it.

The preamble is **server-injected and never returned to the client** — same
discipline as thinking-trace tool I/O. The user sees the persona's name on
their session, not the instruction text.

## API surface

v1 (built-ins only) needs no new routes — `personaId` travels on the existing
`POST /api/orbit/sessions/{id}/continue` body and the session-documents sync.
One tiny read route is convenient for the client to stay in sync with the
server's registry version:

- `GET /api/orbit/personas` → `{ data: Persona[] }` — built-ins (+ custom in
  Tier 2). Lets the picker render without bundling the registry into the
  client if we later want server-authored personas.

Tier 2 adds `POST /api/orbit/personas`, `PUT/DELETE
/api/orbit/personas/{id}`, and `PUT /api/orbit/sessions/{id}/persona`
(mirroring the chat-folder routes and their creator-only guards).

## UI

Minimal, native to the current chat surface — no new page.

1. **Persona picker in the chat header.** A dropdown next to the session title
   (where the folder/rename affordances live): "No persona" default, then the
   seven built-ins grouped by domain with icon + one-line summary. Selecting
   one sets `session.personaId` and pushes it through the scope sync.
2. **Composer chip.** When a persona is attached, a small labelled chip shows
   beside the "Think longer" toggle (e.g. `⚖ Contracts & Claims`), click to
   change or clear. Mirrors how scope and mode already read in the composer.
3. **Sample prompts.** When a session is empty and a persona is attached, the
   welcome/empty state shows that persona's `samplePrompts` as clickable
   starters (the existing empty-state already renders suggestion chips).
4. **Admin (Tier 2).** A "Personas" tab in the admin console to author and
   share custom personas, reusing the console's table + dialog patterns.

Accessibility and theming follow the existing components (dropdown-menu,
composer chips); nothing bespoke.

## Guardrails & failure modes

- **Length cap.** `systemPreamble` (assembled) is capped (~4 KB) so it can't
  crowd out document context in the model window. `buildPersonaPreamble`
  truncates defensively and the custom-persona form enforces field limits.
- **Precedence.** Document-grounded facts always win over persona framing. The
  preamble explicitly instructs: *ground every claim in the attached documents;
  if the documents don't support an answer, say so — never let the persona's
  domain knowledge substitute for the sources.* This keeps personas from
  inducing hallucinated "standard practice."
- **No scope leakage.** A persona never expands document access. It only
  reframes what's already in scope.
- **Deletability.** A deleted/unknown `personaId` resolves to "no persona" —
  the turn proceeds ungated, never errors.
- **Citations preserved.** The output contract for every persona keeps the
  existing `<source>` citation behavior; personas add structure, not a
  different answer protocol.

## Testing

- `tests/personas.test.ts` (well-formedness, ships with v1): every built-in
  persona has a unique id + slug, a non-empty role/priorities/anti-patterns/
  output-contract, an allow-listed icon and a valid domain, ≤ 4 sample
  prompts, and an assembled preamble under the length cap that contains the
  grounding-precedence clause.
- `prepareTurnRequest` unit tests extend to cover preamble prepending in both
  modes and the no-persona passthrough.
- Live smoke: attach each persona to a scoped session and confirm the reply
  shifts register/structure while citations still resolve.

## Rollout

1. **PR 1 (this plan + seed):** `docs/PERSONAS.md`, `lib/personas.ts` (type +
   7 built-ins + `buildPersonaPreamble` + registry lookup), `tests/
   personas.test.ts`. No behavior change — data and contract only.
2. **PR 2:** injection seam (`turn.ts`, `chat.ts`, `/continue` body,
   `personaId` on the session + scope sync) + the picker/chip/sample-prompt UI.
   Built-ins usable end-to-end.
3. **PR 3 (Tier 2):** `OrbitPersona` ontology object, CRUD routes, admin
   authoring tab, `personaId` session column for recovery-safe persistence.

## The seven seed personas

Shipped in `lib/personas.ts`. Each encodes a real AEC discipline lens with
priorities, preferred vocabulary/register, explicit anti-patterns, and an
output contract. Chosen to cover the document types actually in the Jacobs
tenant (WIRs, shop drawings, method statements, PQQs, incident registers) plus
the commercial/proposal work a consultancy runs on.

1. **Contracts & Claims Advisor** (`contracts`) — reads through the lens of the
   conditions of contract (FIDIC / NEC / bespoke), clause references, notice
   and time-bar deadlines, entitlement and liability. Conditional, precise
   register; never gives legal advice as settled fact.
2. **Compliance & Regulatory Reviewer** (`compliance`) — checks documents
   against codes, standards, specifications and regulatory obligations; flags
   gaps, non-conformances, and required approvals. Cites the governing
   clause/standard for every finding.
3. **QA/QC Inspection Analyst** (`quality`) — the WIR/ITP specialist: field
   density tests, hold/witness points, method-statement conformance, approval
   status. Turns inspection records into pass/fail/at-risk with the exact
   acceptance criterion.
4. **Commercial & Cost Analyst** (`commercial`) — quantities, rates,
   valuations, variations, cost impact and payment applications. Quantitative,
   shows the arithmetic, separates fact from estimate.
5. **Health, Safety & Environmental Advisor** (`safety`) — incident registers,
   method statements, risk assessments, permits; hazard identification,
   control adequacy, regulatory reporting thresholds. Non-alarmist but
   uncompromising on life-safety.
6. **Design & Technical Reviewer** (`design`) — shop drawings, design
   submittals, technical queries; design-intent conformance, coordination
   clashes, RFI-worthy ambiguities. Engineering register, dimensioned and
   specific.
7. **Proposals & Bid Strategist** (`proposals`) — PQQs, RFPs, EOIs; win
   themes, compliance-matrix coverage, evaluation criteria, differentiators
   and gaps. Persuasive but evidence-backed; never over-claims capability.

Each persona's full field set (role, priorities, vocabulary, anti-patterns,
output contract, sample prompts) is the source of truth in `lib/personas.ts`;
this list is the index.
