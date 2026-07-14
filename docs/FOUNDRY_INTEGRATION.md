# Foundry integration

Orbit Docs is wired to **Palantir Foundry** over plain REST (the platform
`openapi.yml`) — no Foundry SDK. It runs in two modes and switches
automatically:

| Mode | When | Data source |
| --- | --- | --- |
| **Demo** | no Foundry auth configured | built-in simulated data (`lib/data.ts`) |
| **Live** | `FOUNDRY_TOKEN` or `FOUNDRY_CLIENT_ID`/`FOUNDRY_CLIENT_SECRET` set | Foundry ontology + AIP agents |

The client probes `GET /api/orbit/config` once on load (`LiveProvider`) and
picks the mode. Every `/api/orbit/*` route returns **503** in demo mode so the
UI stays on its simulation; nothing else changes.

## How Foundry is used (mirrored from the PoC backend)

- **Documents** live in the `OrbitDocsList` ontology object; the PDF bytes are
  a `MediaReference` into media set
  `ri.mio.main.media-set.5254ad72-…`. Indexing status comes from the separate
  `OrbitDocIndexStatus` object (`isIndexingComplete`).
- **Folders** are `OrbitFolders` (a `contents` array of doc primary keys).
- **Chat** is Sessions v2: `OrbitDocsUserSessions` + `OrbitSessionMessages` +
  `OrbitSessionBranches`, with each turn run through an **AIP agent**
  (`streamingContinue`) scoped to the selected docs via a `userDocs` objectSet
  parameter. Citations arrive inline as
  `<source id="ri.mio.…media-item.…" name="…" text="…">page</source>` tags.
- **Sync sources** are `OrbitSyncSource` (SharePoint), read-only here.

All the exact object/action/query api names, agent RIDs, and the objectSet
parameter shape are encoded in `lib/foundry/`.

## Server layer (`lib/foundry/`, all `server-only`)

| File | Responsibility |
| --- | --- |
| `config.ts` | reads env, decides live vs demo |
| `token.ts` | OAuth2 client-credentials token cache (60s refresh margin, single-flight) |
| `client.ts` | typed REST helpers: object search/get, action apply, query execute, AIP sessions, media set |
| `llm-proxy.ts` | vendor-native LLM proxy client (OpenAI/Anthropic compatible) for lightweight text tasks |
| `ontology.ts` | data layer + serializers, PoC access rules, 5s TTL caches |
| `turn.ts` | **pure** turn preparation (agent choice, context, param inputs, stream-error sentinel) — unit-tested |
| `chat.ts` | one agent turn end-to-end: persist → stream passthrough → persist reply + metadata |

### LLM proxy (`llm-proxy.ts`)

Foundry exposes provider-compatible endpoints under
`{host}/api/v2/llm/proxy/{provider}/v1/…`, authenticated with the **same
Foundry bearer token** used everywhere else:

- **OpenAI:** `POST /openai/v1/chat/completions`
- **Anthropic:** `POST /anthropic/v1/messages` (adds `anthropic-version` header;
  system prompt is hoisted out of the `messages` array)

`complete({ messages, provider?, model?, … })` normalizes both shapes and
returns the assistant text. Provider/model default to the `llmProxy` block in
`config.ts` (env-overridable), so swapping models is a config change — no code.

This bypasses the AIP-session/ontology-query round-trip for tasks that don't
need document grounding or citations. Main chat turns stay on AIP agents (which
supply the `userDocs` grounding + inline citations), and Studio doc edits stay
on the ontology **refining query** (prompted for the doc-envelope markdown +
`<source>` tags). The **email refine** opts into the proxy per-request via
`liveApi.refine({ engine: "llm-proxy", … })`.

`POST /api/orbit/refine` picks the engine from the request body's `engine`
field, falling back to `REFINE_ENGINE`, then `query`.

**Env:**

| Var | Default | Purpose |
| --- | --- | --- |
| `LLM_PROXY_PROVIDER` | `openai` | `openai` or `anthropic` |
| `LLM_PROXY_MODEL` | `gpt-4o` / `claude-sonnet-4` | model id for the provider |
| `LLM_PROXY_MAX_TOKENS` | `2048` | max completion tokens |
| `REFINE_ENGINE` | `query` | default engine when a request omits `engine`; set to `llm-proxy` to flip the default |

## API routes (`app/api/orbit/`)

`config`, `bootstrap` (single-round-trip hydrate), `docs` (+ `status`,
`upload`, `[pk]`, `[pk]/content`), `media/[rid]/content`, `folders` (+ `[id]`),
`sessions` (+ `[id]`, `title`, `documents`, `content`, `run`, `continue`,
`branches`, `branches/[branchId]`, `branches/[branchId]/activate`), `refine`,
`sync/sources`.

## Client wiring

- `components/live-provider.tsx` — probes config, hydrates the store from
  `/bootstrap`, polls indexing status for pending docs.
- `lib/live-api.ts` — typed fetch client + the streaming reader (`streamTurn`).
- `lib/live-map.ts` — maps Foundry payloads into the existing store shapes.
- `components/chat/use-live-chat.ts` — live chat driver (same interface as the
  demo `useChatSimulation`); `use-chat.ts` picks the right one by mode.
- `components/live-pdf-dialog.tsx` — opens the real source PDF for a citation
  from `/api/orbit/media/{rid}/content`, seeking to the cited page.

Store mutations (scope changes, deletes) fan out to Foundry via
`lib/live-sync.ts` so every existing UI call site keeps working unchanged.

## Latency

- **One** bootstrap round-trip instead of a 4-request waterfall on load.
- AIP session creation runs **concurrently** with user-message persistence in
  `runSessionTurn` (the "thinking" delay is network-bound).
- The stream is **passed straight through** to the browser with zero
  re-buffering; markdown renders as it arrives.
- The two hot full-scans (`OrbitDocIndexStatus`, accessible folders) are
  **memoized for 5s with single-flight**, collapsing the bootstrap + docs +
  status-poll bursts into one upstream query each.
- List queries use **property projection** (`select`) to shrink payloads.
- Chunked `in` filters (100 ids) batch-fetch shared docs by key.

## Testing

`bun test` covers the pure logic (turn prep, citation parsing, ontology
serializers, live mappers). The live API paths are exercised whenever the
Foundry host is reachable — in a sandbox with the host blocked by egress
policy, demo mode and the 503 guards are what run.

## Notes / limits

- Office uploads (`.docx/.pptx/.xlsx`) are converted to PDF by LibreOffice in
  the PoC backend; that dependency isn't bundled here, so live upload accepts
  **PDF** and returns a clear 415 otherwise. Page count is computed server-side
  with `pdf-lib`.
- Thinking mode and admin surfaces exist in the PoC; this build ships the
  primary chat agent and the core doc/chat/citation flows.
