# Decisions

Why each contested choice went the way it did. Revisit these when the constraints change —
particularly the ORM one, which is the closest call.

## Elysia over Hono

Both are excellent. Elysia wins here for two specific reasons:

1. **TypeBox is built in.** Hono needs a separate validator (`zod`, `valibot`, or
   `@hono/typebox-validator`) — an extra dependency for the one thing we most wanted to avoid.
   Elysia's `t` *is* TypeBox, and its schemas are compiled into JIT'd validators.
2. **Eden Treaty is a first-class contract.** Hono's `hc` client works, but its inferred types get
   expensive for `tsc` as the route tree grows, and it does not carry response validation as
   cleanly.

Hono's advantage is portability across runtimes (Workers, Deno, Node). We deploy Bun in a
container, so that advantage buys nothing here.

**Cost to watch:** Elysia's inference is doing real work. If `tsc` slows down, split routes into
more plugin modules and reuse schemas via `.model()` instead of inlining them — inference cost
scales with the size of a single chained instance, not the number of instances.

## Kysely over Drizzle, Prisma, and TypeORM

The requirements were: stable today, fast, precisely typed, and no re-declaring types by hand.

**Drizzle** — schema-in-TypeScript is the nicest authoring model of the four, but its SQL Server
dialect is a 1.0 **beta/RC**. Not a foundation to put a fleet of internal apps on. Revisit when it
is GA; the repository interface in `src/server/modules/*/repository.ts` is where it would land.

**Prisma 7** — genuinely much better than its reputation: the Rust engine is gone (WASM/TypeScript
query compiler, ~85–90% smaller), `@prisma/adapter-mssql` is GA, and it runs on Bun. It has the
strongest "define once" story: `schema.prisma` generates the client, the types and the migrations.
Two costs decided it: the heaviest runtime of the four (WASM init on a small container), and
`prisma migrate dev` on SQL Server requires a **shadow database** — a second Azure SQL database to
provision and pay for. Pick Prisma if the domain turns out to be relation-heavy and the team wants
migrations generated rather than written.

**TypeORM 1.x** — no longer unmaintained (1.0 in May 2026 after new maintainers took over), so the
usual objection is stale. The structural problems remain, though: decorators plus
`reflect-metadata` at runtime, an entity metadata graph built on every boot, and inference that
degrades exactly where it matters — `QueryBuilder.getRawMany()` is `any`, and partial selects and
relation loading are not precisely typed, so you end up hand-writing DTO types anyway.

**Kysely** — a typed query builder, not an ORM. It compiles to SQL and hands it to `tedious`; there
is no identity map, no lazy loading, no metadata graph, and nothing to initialise at boot. Every
join and partial select is exactly typed. Migrations are first-class, and `kysely-codegen`
introspects the migrated database to regenerate `schema.generated.ts`, so the schema is declared
once — in a migration — and never retyped.

The trade is real: you write joins yourself. For a base that exists to stay fast on small
containers, that is the right side of the trade.

## No zod

Nothing in a shipped bundle validates with zod. TypeBox already ships with Elysia and covers the
same ground for the API boundary, and `scripts/check-no-zod.ts` fails the build if zod ever
appears in a bundle's source map. zod stays in the lockfile as a build-time dependency of the
TanStack router plugin and `kysely-codegen`; neither ships.

## shadcn on Base UI rather than Radix

Base UI is smaller, has a cleaner composition API (`render` instead of `asChild`), and is under
active development by the team behind MUI. shadcn supports both; `components.json` records the
choice (`"style": "base-nova"`), so `shadcn add` keeps generating matching components.

Buttons get `cursor: pointer` — Tailwind v4's preflight dropped it, and `shadcn init --pointer`
writes the rule back into `globals.css`.

## TanStack Query alongside TanStack Router

The router has its own loader cache, which is enough for simple cases. Query is here because
mutations, optimistic updates, invalidation and background refetch are the parts that actually get
hard. The division of labour: the **router** decides *when* to load (on hover, via
`defaultPreload: 'intent'`), the **query client** decides *whether* a fetch is needed.
`defaultPreloadStaleTime: 0` hands freshness entirely to Query so the two caches can never
disagree.

## Bundling the server into the image

`bun build --target bun` inlines every dependency into one file, so the runtime image contains
`dist/` and nothing else — no `node_modules`, no install step at deploy time, a smaller image and a
faster cold start.

If a native or dynamically-required dependency ever fails to bundle, the fallback is to mark it
`--external` and run `bun install --production --frozen-lockfile` in the runtime stage.

## TypeScript 7

The native compiler is stable and roughly an order of magnitude faster to typecheck, which matters
because Eden's inferred types are the heaviest thing in the project. Vite/Rolldown transpiles with
Oxc and never calls `tsc`, so this only affects `bun run typecheck`.
