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
| `ontology.ts` | data layer + serializers, PoC access rules, 5s TTL caches |
| `turn.ts` | **pure** turn preparation (agent choice, context, param inputs, stream-error sentinel) — unit-tested |
| `chat.ts` | one agent turn end-to-end: persist → stream passthrough → persist reply + metadata |

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
