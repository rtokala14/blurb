# Orbit Docs

A UI/UX prototype for an **enterprise document intelligence** product — built with
[Next.js](https://nextjs.org) (App Router), [Bun](https://bun.sh), Tailwind CSS v4,
and the latest [shadcn/ui](https://ui.shadcn.com) component baseline.

It runs in two modes:

- **Demo** (default, no config) — fully interactive placeholder with seeded
  client-side data; every flow is simulated with realistic timing.
- **Live** — set Foundry credentials (see below) and `/api/orbit/*` routes
  proxy **Palantir Foundry** over plain REST (no SDK): real documents, folders,
  chat with the AIP agent, streamed answers, and inline citations that open the
  actual source PDF. See [`docs/FOUNDRY_INTEGRATION.md`](docs/FOUNDRY_INTEGRATION.md).

The mode is detected automatically at load; the same UI drives both.

## Run it

```bash
bun install
bun dev        # http://localhost:3000
```

`bun run build` produces a production build; `bun start` serves it.
`bun test` runs the unit suite (Foundry turn prep, citation parsing, mappers).

### Live mode (Palantir Foundry)

Copy `.env.example` to `.env.local` and set either a `FOUNDRY_TOKEN` or
`FOUNDRY_CLIENT_ID`/`FOUNDRY_CLIENT_SECRET` (plus `ORBIT_USER_EMAIL`). On next
load the app connects to Foundry; without them it stays in demo mode. Full
detail in [`docs/FOUNDRY_INTEGRATION.md`](docs/FOUNDRY_INTEGRATION.md).

### SendGrid (optional)

Per-batch "email me when indexing is done" notifications post to
`/api/notify-indexed`, which delivers through SendGrid. Copy `.env.example`
to `.env.local` and set `SENDGRID_API_KEY` (+ a verified
`SENDGRID_FROM_EMAIL`) to send real email — without a key the route answers
in simulated mode so the flow still completes end to end.

## What's inside

### App shell
- Collapsible sidebar (workspace nav + pinned/recent sessions), light & dark themes
- Global command palette (`⌘K`): jump anywhere, search documents, run actions
- Keyboard-first: `?` opens the shortcuts dialog — `⌘1–5` navigation, `⌘⇧O`
  new session, `⌘⇧U` upload, `⌘.` documents panel, `⌘⇧E` export, `Esc` stop
  generating, `⌥↑/↓` jump turns, and typing anywhere focuses the composer
- Responsive: panels become off-canvas sheets on small screens, tables shed
  columns, and hover actions stay visible on touch

### Dashboard `/`
- Library index coverage, ingestion pipeline with live upload/OCR/indexing states
- Workspace activity feed, recent documents & sessions

### Documents `/documents`
- Folder tree (uploads, SharePoint-synced, AI workspace), breadcrumbs, list/grid views
- Upload dialog: drag & drop, staged progress (uploading → extracting → indexing → ready)
- SharePoint folder banner with simulated delta sync and conflict states
- Right-click context menus (preview, ask in chat, move, delete with undo)
- Detail sheet: AI summary, metadata, tags, version history, "Ask in chat"

### Chat `/chat`
- **Context scoping** — tri-state folder/document picker with token estimate; answers
  are only "grounded" in the selected scope (scope chips above the composer)
- **Agent thinking indicator** — streamed reasoning steps (plan → search → read →
  analyze → synthesize/tool) with per-step document chips; collapses when done
- **Message streaming** with caret, stop button, and regenerate
- **Inline citations** — numbered chips with hover previews; click opens a PDF
  viewer modal with the cited passage highlighted on the exact page
- **Chat branching** — edit any user message ("Send & branch") or regenerate an
  answer to fork; switch branches with `‹ 2/3 ›` controls; branch points flagged
- **Turns navigator** — session outline rail with citation/artifact/branch markers
- **Session export** — PDF/Markdown/Word with citation appendix & reasoning options
- **Per-message download** — save any assistant response as real `.md`, `.pdf`
  (jsPDF), or `.docx` (docx) files, with or without the references section
- **Refine & send as email** — tone/length controls, AI rewrite streamed live,
  citation → source-list conversion, simulated send
- Slash commands (`/doc`, `/sheet`, `/deck`) for AI-assisted creation

### Studio `/studio` (also opens as a split panel inside Chat)
- **Document editor** — sections stream in during generation; AI edits appear as
  tracked insertions with accept/reject
- **Spreadsheet editor** — formula bar, sheet tabs, cell selection; AI edits add
  highlighted scenario columns with formulas
- **Deck editor** — thumbnail rail, slide canvas, speaker notes; slides appear
  live during generation and AI can rewrite the current slide
- Every artifact lists the source documents it was grounded in

### Connections `/connections`
- SharePoint connection with per-site health, mapping, conflict resolution,
  auto-sync toggle, simulated "Sync now", and a connect-a-site dialog

## Stack notes

- Components live in `components/ui` — the shadcn `new-york-v4` baseline vendored
  as-is (Radix primitives via the unified `radix-ui` package)
- Client state is a single [zustand](https://github.com/pmndrs/zustand) store
  (`lib/store.ts`); chat history is a message *tree*, which is what makes
  branching real rather than cosmetic
- Simulated agent behavior lives in `lib/simulated-responses.ts` and
  `components/chat/use-chat-simulation.ts`
