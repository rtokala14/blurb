# Personas — implementation plan

Status: **planned** (this document + the persona registry in `lib/personas.ts`
are committed; no wiring yet). Owner: phase-2 development cycle.

## 1. Concept

A **Persona** is an optional, named bundle of domain expertise a user attaches
to a chat session. It tells the agent *how to work with a class of documents*:
the role to adopt, the terminology and conventions of that discipline, the
output shapes practitioners expect, and — critically — the anti-patterns to
avoid (tone, hedging, paraphrasing clause text, giving advice it must not
give). Personas are curated content shipped with the app, not free-form user
prompts.

Seven launch personas cover Jacobs' AEC consulting core: contracts,
compliance/QA-QC, HSE, commercial/cost, bids & proposals, project controls,
and design management. Each maps directly onto document types already in the
tenant (WIRs, shop-drawing approvals, PQQ references, incident registers,
method statements, BOQs, tender documents).

**Non-goals (v1):** user-authored personas; per-message persona switching;
persona-specific Foundry agents; automatic persona detection from scope.

## 2. How it fits the existing architecture

The Foundry AIP agent is fixed — we cannot edit its system prompt. But the
app already assembles the user input server-side per turn:

- `lib/foundry/turn.ts` → `prepareTurnRequest()` is a **pure** function that
  builds the final `userInput`. Regular mode wraps the message with compact
  context via `wrapRegularModePrompt()`; thinking mode passes context through
  the `prevContext` string parameter.
- `lib/foundry/chat.ts` → `runSessionTurn()` calls it with session state.
- `app/api/orbit/sessions/[id]/continue/route.ts` receives the turn request.

Persona guidance is injected at exactly this seam. **The client only ever
sends a `personaId`; the guidance text is resolved server-side from the
registry.** Users cannot supply persona text — that keeps the injection
surface closed and the