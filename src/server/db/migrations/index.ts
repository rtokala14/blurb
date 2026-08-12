import type { Migration } from 'kysely/migration'
import * as createTodos from './0001_create_todos'

/**
 * Migrations are listed explicitly rather than discovered from disk: the
 * production image ships a bundled server with no source tree to scan, and an
 * explicit list means a missing file is a compile error, not a runtime surprise.
 *
 * Add new files as `NNNN_description.ts` and register them here, in order.
 */
export const migrations: Record<string, Migration> = {
  '0001_create_todos': createTodos,
}
