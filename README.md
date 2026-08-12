# bun-stack

A performance-first starter for internal apps: **one runtime, one image, one type system**.

Bun runs the package manager, the server, the test runner and the bundler. Elysia serves a
TypeBox-validated API. The React SPA is built by Vite and served by the same Bun process, so
production is a single container with no reverse proxy, no Node, and no second origin.

```
bun install
docker compose -f docker-compose.dev.yml up -d   # local SQL Server
cp .env.example .env                             # then set DB_DRIVER=mssql
bun run db:migrate
bun dev                                          # http://localhost:5173
```

`DB_DRIVER=memory` (the default) skips the database entirely, so the app runs with nothing else
installed.

## The stack

| Layer | Choice | Why this one |
| --- | --- | --- |
| Runtime / PM / tests / bundler | **Bun 1.3** | One toolchain. `bun test` needs no vitest, `bun build` needs no tsup. |
| HTTP | **Elysia** | Fastest Bun-native router, and TypeBox is built in — validation with no extra dependency. |
| Validation | **TypeBox** (via `elysia`'s `t`) | Compiles to JIT'd validators. One schema is the runtime check *and* the client type. |
| RPC | **Eden Treaty** | The server's type is imported into the browser with `import type`. No codegen, no generated client, nothing at runtime. |
| Routing | **TanStack Router** | Type-safe routes, loaders that start on hover, automatic per-route code splitting. |
| Server state | **TanStack Query** | Owns caching and invalidation; the router only triggers loads. |
| UI | **shadcn/ui on Base UI** | Components are source in your repo. Base UI is lighter than Radix and actively developed by the MUI team. |
| PWA | **Hand-written service worker** | ~120 lines, no Workbox. Precache manifest injected from the real build output. |
| Styling | **Tailwind v4** | Oxide engine, no PostCSS config, no `tailwind.config.js`. |
| React | **React 19 + React Compiler** | Auto-memoisation at build time, so app code carries no `useMemo`/`useCallback` noise. |
| Database | **Kysely + tedious** | Typed SQL for Azure SQL with effectively zero runtime overhead. See [docs/decisions.md](docs/decisions.md). |

There is **no zod** in any bundle. It appears in the lockfile only as a build-time dependency of
the TanStack router plugin and `kysely-codegen`; neither the server bundle nor the browser bundle
contains it. `bun run check:no-zod` asserts that.

## Layout

```
src/
  server/
    index.ts              composition root — picks implementations, starts the server
    app.ts                the API surface; its type is the RPC contract
    env.ts                parsed and validated at boot, fails loudly
    static.ts             in-memory SPA serving with precompressed assets
    db/
      index.ts            Kysely + tedious + tarn wiring
      schema.generated.ts database types (regenerate with `bun run db:codegen`)
      migrations/         explicit, ordered, registered in index.ts
    modules/<feature>/
      model.ts            TypeBox schemas — the contract
      repository.ts       storage interface + SQL and in-memory drivers
      service.ts          application logic, depends on the interface only
      routes.ts           transport: validate, delegate, map to a status
  web/
    routes/               file-based routes (TanStack Router)
    lib/api.ts            Eden client
    lib/query.ts          QueryClient defaults
    lib/<feature>.ts      queryOptions + mutation hooks, one key factory
    components/ui/        shadcn components (yours to edit)
    sw.ts                 service worker (built separately, see scripts/sw-plugin.ts)
    public/               manifest, icons — served and precached as-is
  shared/                 values both sides need
tests/                    bun test — server routes and React components
```

## The three patterns worth copying

**1. The API type is the client.** `src/web/lib/api.ts` does `import type { Api } from '@server/app'`.
Because it is a type-only import, no server code reaches the browser — but renaming a route or
changing a response field breaks the frontend build immediately.

**2. Loaders prime the cache, components read it.** A route loader calls
`queryClient.ensureQueryData(...)` and the component calls `useSuspenseQuery(...)` with the *same*
`queryOptions`. With `defaultPreload: 'intent'` the fetch starts on hover, so by the time the
component mounts the data is usually already there — and there is no `isLoading` branch to write.

**3. Storage sits behind an interface.** `TodoRepository` has a Kysely driver and an in-memory
driver. Tests and `bun dev` use the second one, which is why the suite needs no database and runs
in under a second.

### Adding a feature end to end

```
src/server/modules/thing/{model,repository,service,routes}.ts   # define the contract
src/server/app.ts                                               # .use(thingRoutes(...))
src/web/lib/thing.ts                                            # queryOptions + mutations
src/web/routes/thing.tsx                                        # loader + useSuspenseQuery
```

No client regeneration step — the types follow the moment the server file is saved.

## Database

Migrations are the source of truth; types are generated from the migrated database.

```bash
bun run db:migrate                          # apply everything pending
bun run db:rollback                         # revert the last one
bun run src/server/db/migrate.ts status     # what is applied
bun run db:codegen                          # regenerate src/server/db/schema.generated.ts
```

Add `src/server/db/migrations/NNNN_name.ts` and register it in `migrations/index.ts` — the list is
explicit so a missing file is a compile error rather than a production surprise.

`DATABASE_URL` accepts the ADO.NET form the Azure portal gives you
(`Server=tcp:...,1433;Initial Catalog=...;User ID=...;Password=...;Encrypt=True`) or a
`mssql://user:pass@host:1433/db` URL. Prefer the ADO form — `kysely-codegen` reads the same
variable and only parses that one.

In CI, migrations run against a throwaway SQL Server container to prove they apply to a clean
database and are a no-op on second run. In production, the `migrate` job in
`.github/workflows/deploy.yml` runs them against the connection string in the `DATABASE_URL`
environment secret. Write them expand-then-contract so the running image keeps working while they
apply.

Notes for Azure SQL:

- Primary keys are monotonic identities, not random GUIDs — SQL Server clusters on the PK and
  random keys fragment the index on every insert.
- Listing endpoints use keyset pagination (`WHERE createdAt < ?`) rather than `OFFSET`, so page
  1000 costs the same as page 1.
- Column names match the TypeScript field names exactly, so nothing is remapped at runtime.

## PWA

Installable and offline-capable out of the box. `bun run build` emits `dist/client/sw.js` with a
precache manifest generated from what the build actually produced — bundled chunks, the shell, and
everything copied from `public/`.

Caching strategy, by request type:

| Request | Strategy |
| --- | --- |
| `/api/*` | **Never cached.** The network is the source of truth; stale data is worse than none. |
| Navigations | Network first (with navigation preload), falling back to the cached shell — so a refresh works offline. |
| `/assets/*` | Cache first. Filenames are content-hashed, so a hit can never be stale. |
| Everything else | Stale while revalidate. |

**Credentials.** Two different problems, and only one has an HTML attribute:

- **Manifest** — browsers fetch `manifest.webmanifest` *anonymously* by default, so behind an auth
  proxy it 401s or redirects and the app silently stops being installable. Fixed with
  `crossorigin="use-credentials"` on the link tag, which `index.html` sets.
- **Service worker** — the `/sw.js` request already carries same-origin cookies, and `register()`
  has no equivalent option. What breaks auth-gated deployments here is different: a service worker
  script response **may not be a redirect**, so an auth proxy that bounces `/sw.js` to a login page
  fails registration outright. Exempt `/sw.js` and `/manifest.webmanifest` from redirect-based auth
  at the proxy.

The server serves `/sw.js` with `Cache-Control: no-cache` and `Service-Worker-Allowed: /`, and
registration uses `updateViaCache: 'none'`, so a deploy is always picked up.

**Updates** are a prompt, not a surprise reload: when a new worker is waiting, `UpdatePrompt` offers
a Reload button, which posts `SKIP_WAITING` and reloads once the new worker takes control. Swapping
the page out mid-task would lose work.

Icons live in `src/web/public` and are committed. After changing the artwork, regenerate the PNGs:

```bash
bun run scripts/generate-icons.ts     # rasterises the SVGs with headless Chrome
```

Offline *writes* — queueing mutations and syncing when the connection returns — are the next piece.
The service worker deliberately leaves `/api/*` alone so that layer has a clean slate.

## Deployment

```bash
docker build -t bun-stack .
docker run --rm -p 3000:3000 -e DB_DRIVER=memory bun-stack
```

The build stage produces `dist/client` and a **self-contained** `dist/server/index.js` — every
dependency is inlined, so the runtime stage copies `dist/` and nothing else. No `node_modules` in
the final image, and it runs as a non-root user.

`.github/workflows/deploy.yml` pushes to ACR using federated credentials (no stored client
secret) and then applies migrations. Set:

| Kind | Name |
| --- | --- |
| Variables | `ACR_NAME`, `IMAGE_NAME` |
| Secrets | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `DATABASE_URL` |

Probes: `/api/health` for liveness (never touches the database) and `/api/health/ready` for
readiness (does). The process drains in-flight requests on SIGTERM before exiting.

Configuration is in `.env.example`; everything is validated at boot by `src/server/env.ts`.

## Performance choices

- **Static assets are prepared once at boot** — bytes, ETag, Brotli and gzip variants all live in
  memory, so a request is a `Map` lookup and a `Response`. No disk I/O, no per-request compression.
  Hashed assets get `immutable` caching; `index.html` revalidates. Boot cost is roughly 600 ms for
  a typical bundle; lower `BROTLI_PARAM_QUALITY` in `src/server/static.ts` if that matters more
  than transfer size.
- **`precompile: true`** builds every Elysia validator at startup, so the first request after a
  cold start is not the slow one.
- **Vendor chunks are split** from app code, so shipping a feature does not invalidate React in
  browser caches. Routes are split automatically.
- **Source maps are `hidden`** — generated for error tracking, never referenced by the app.
- **React Compiler** handles memoisation; don't hand-write it.

## Commands

| | |
| --- | --- |
| `bun dev` | API and Vite together, one Ctrl-C |
| `bun run build` | SPA + server bundle into `dist/` |
| `bun start` | Run the production build |
| `bun run test` | Both suites — server, then components |
| `bun run test:web` | Component tests only (needs the DOM preload) |
| `bun run typecheck` | `tsc --noEmit` (TypeScript 7, native) |
| `bun run lint` / `lint:fix` | Biome — replaces ESLint and Prettier |
| `bun run check` | Typecheck + lint + test, what CI runs |

## Deliberately not here yet

Auth, email, offline write sync, and observability are next. The seams for them exist: modules are
self-contained plugins, the composition root is one file, and the service worker will slot in at
the Vite layer without touching the API.
