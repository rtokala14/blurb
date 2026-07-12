# Handoff — continue here in the allowlisted session

> **STATUS UPDATE (2026-07-12, live-verified session):** Steps 0–2 are DONE.
> Egress to the tenant works; `scripts/foundry-smoke.mjs` passes 10/10 live
> (OAuth, docs joined with OrbitDocIndexStatus — 19,236 docs / 18,391
> indexed — sessions, streamed agent turn with citations, session trace with
> tool calls, citation PDF fetch). The app ran live end-to-end: chat with
> streamed cited replies, high-level thinking traces (new `/trace` route),
> corpus-wide document search, edit-and-branch. Cold bootstrap optimized
> ~8s → 0.76s realistic / 2.3s true-cold. Key correction baked in
> everywhere: **isIndexed comes from the OrbitDocIndexStatus object
> (isIndexingComplete), not the doc row's isIndexed property** — that
> property is stale on virtually the whole tenant. Remaining untested live:
> the upload path (known gaps 1–3 below). Remind the user to rotate the
> shared CLIENT_SECRET.

You're picking up **Orbit Docs**, a Next.js 16 + Bun app: a Jacobs-branded
"enterprise document intelligence" UI that talks to **Palantir Foundry** over
plain REST (no `docai_sdk`). Branch: `claude/orbit-docs-ui-ux-yxxy6g`. Everything
described below is already committed and pushed.

## What the user wants next

Run the **live Foundry integration end-to-end** against the real tenant and
fix anything that doesn't work. Previous sessions couldn't do this because the
sandbox's egress policy blocked `jacobs.palantirfoundry.com` (403 "Host not in
allowlist"). This session should be in an environment where that host **is**
allowlisted — verify first, then test.

Do not re-ask the user for context or permissions. They have explicitly
authorized operating on the account for **`rohit.tokala@jacobs.com`** (their own
docs/sessions) and given test credentials.

## Step 0 — credentials

The integration reads Foundry auth from env or `.env.local` (gitignored, so it
is NOT in a fresh clone). Recreate it if absent:

```
FOUNDRY_HOSTNAME=https://jacobs.palantirfoundry.com
CLIENT_ID=<client id>
CLIENT_SECRET=<client secret>
ORBIT_USER_EMAIL=rohit.tokala@jacobs.com
```

The user has the CLIENT_ID/CLIENT_SECRET (they shared them earlier as an image;
ask them to paste, or they may have set them as environment variables in the
environment config). A `FOUNDRY_TOKEN=<jwt>` also works and wins over OAuth.
**Never commit `.env.local`** — it is in `.gitignore`.

## Step 1 — verify egress, then run the smoke test

```bash
NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node scripts/foundry-smoke.mjs
```

This is the one-shot live check (no Next server needed). It runs: OAuth token →
list documents → list sessions → create a session + one agent turn
(`streamingContinue`, printing streamed markdown + citations) → fetch the first
citation's media PDF. It prints `Result: N passed, M failed`.

If the first line 403s with "Host not in allowlist", egress still isn't open —
tell the user; don't try to route around it.

## Step 2 — run the app live

```bash
bun install
bun run build && bun run start   # or: bun dev
```

Then drive it (Playwright with `executablePath: /opt/pw-browsers/chromium`, per
the run patterns used in earlier sessions). The app auto-detects live mode via
`GET /api/orbit/config`. Exercise:

- Documents library populated from Foundry (`/api/orbit/bootstrap`).
- Open a real chat session → transcript loads (`/sessions/{id}/content`).
- Send a message → streamed reply, thinking indicator, inline citations.
- Click a citation → real source PDF opens at the cited page
  (`/api/orbit/media/{rid}/content`, rendered by `LivePdfDialog`).
- Upload a PDF → indexing status polls to ready.

## Architecture (so you don't re-derive it)

Full detail in `docs/FOUNDRY_INTEGRATION.md`. In short:

- **Server layer** `lib/foundry/` (all `server-only`): `config.ts` (mode),
  `token.ts` (OAuth cache), `client.ts` (REST: objects/actions/queries, AIP
  sessions + streamingContinue, media set), `ontology.ts` (data layer +
  serializers + 5s TTL caches), `turn.ts` (pure turn prep — unit-tested),
  `chat.ts` (one turn: persist + stream passthrough + persist reply).
- **API routes** `app/api/orbit/*` — mirror the PoC endpoints; all 503 in demo
  mode. Key: `config`, `bootstrap`, `docs` (+status/upload/[pk]/content),
  `media/[rid]/content`, `folders`, `sessions/*` (content/run/continue/branches),
  `refine`, `sync/sources`.
- **Client** `components/live-provider.tsx` (hydrate + poll), `lib/live-api.ts`
  (fetch + `streamTurn` reader), `lib/live-map.ts` (Foundry → store shapes),
  `components/chat/use-live-chat.ts` (live chat, same interface as the demo
  `useChatSimulation`; `use-chat.ts` picks by mode), `components/live-pdf-dialog.tsx`.
- Store mutations fan out to Foundry via `lib/live-sync.ts`.

Key constants (from the PoC, all overridable by env): ontology `jacobs-ontology`;
primary agent `ri.aip-agents..agent.b5324c77-…`; thinking agent
`ri.aip-agents..agent.01ce23ea-…`; media set `ri.mio.main.media-set.5254ad72-…`.
Citations stream inline as `<source id="ri.mio.…media-item.…" name="…" text="…">page</source>`.

## Known gaps to watch for during live testing

1. **MediaReference shape on upload** — `lib/foundry/client.ts uploadMedia()`
   returns the platform `Core.MediaReference` and we pass it straight to the
   `create-orbit-docs-list` action's `reference` param. If Foundry rejects it,
   compare against what `mediasets/media/upload` actually returns and adjust.
2. **`extractMediaItemRid`** (`lib/foundry/ontology.ts`) parses the media RID out
   of the stored `reference` for doc PDF preview — verify against a real row's
   shape; there's a deep-scan fallback but confirm it hits.
3. **Office uploads**: only PDF is accepted (415 otherwise) — the PoC's
   LibreOffice conversion isn't bundled. Fine to leave; note it if the user
   tries a .docx.
4. **Action param names**: verified against `docai-openapi.yaml` (kebab-case api
   names, camelCase params) but not run live. If an action 400s on a param,
   check the spec: the PoC bundle is at
   `/tmp/.../scratchpad/poc/DIA-Orbit-Docs-dev-v2` if still present, else the two
   yaml specs in that zip.

## Guardrails

- `bun test` (61 unit tests) and `bunx tsc --noEmit` must stay green.
- Develop on `claude/orbit-docs-ui-ux-yxxy6g`; commit + push there.
- Don't create a PR unless asked.
- Suggest the user rotate the shared CLIENT_SECRET/token after testing.
