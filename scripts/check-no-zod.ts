#!/usr/bin/env bun
/**
 * Asserts that zod is not in any shipped bundle.
 *
 * zod is unavoidable in the lockfile — the TanStack router plugin and
 * kysely-codegen depend on it — but it must never reach the browser or the
 * server bundle. Source maps list every module that went into a bundle, which
 * makes this an exact check rather than a string search over minified output.
 *
 *   bun run build && bun run check:no-zod
 */
import { Glob } from 'bun'

const BANNED = ['node_modules/zod/', 'node_modules/.bun/zod@']

const maps = [...new Glob('dist/**/*.map').scanSync('.')]

if (maps.length === 0) {
  console.error('No source maps found in dist/. Run `bun run build` first.')
  process.exit(1)
}

const offenders: string[] = []

for (const map of maps) {
  const { sources = [] } = (await Bun.file(map).json()) as { sources?: string[] }
  for (const source of sources) {
    if (BANNED.some((banned) => source.includes(banned))) offenders.push(`${map} → ${source}`)
  }
}

if (offenders.length > 0) {
  console.error('zod reached a shipped bundle:')
  for (const offender of offenders) console.error(`  ${offender}`)
  process.exit(1)
}

console.log(`✓ ${maps.length} bundles checked, no zod`)
