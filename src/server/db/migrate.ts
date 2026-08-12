#!/usr/bin/env bun
import { type MigrationProvider, Migrator } from 'kysely/migration'
import { createDatabase } from './index'
import { migrations } from './migrations'

/**
 * Migration runner. Used locally against Docker SQL Server and in CI against
 * the deployment target (connection string comes from a repository secret).
 *
 *   bun run db:migrate            apply every pending migration
 *   bun run db:rollback           revert the most recent migration
 *   bun run src/server/db/migrate.ts status
 */

const provider: MigrationProvider = {
  getMigrations: async () => migrations,
}

const command = process.argv[2] ?? 'up'

const db = createDatabase()
const migrator = new Migrator({ db, provider })

try {
  if (command === 'status') {
    const applied = await migrator.getMigrations()
    for (const migration of applied) {
      console.log(`${migration.executedAt ? '✓' : '·'} ${migration.name}`)
    }
    process.exit(0)
  }

  const { error, results } = await (command === 'down'
    ? migrator.migrateDown()
    : migrator.migrateToLatest())

  for (const result of results ?? []) {
    const verb = result.direction === 'Up' ? 'applied' : 'reverted'
    if (result.status === 'Success') console.log(`✓ ${verb} ${result.migrationName}`)
    else if (result.status === 'Error') console.error(`✗ failed ${result.migrationName}`)
  }

  if (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  }

  if ((results ?? []).length === 0) console.log('Nothing to migrate.')
} finally {
  await db.destroy()
}
