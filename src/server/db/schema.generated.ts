/**
 * Database types.
 *
 * The migrations under `src/server/db/migrations` are the single source of
 * truth for the schema. This file mirrors them so TypeScript knows the shape.
 *
 * Regenerate it from a live database instead of hand-editing:
 *   bun run db:migrate      # apply migrations to your local SQL Server
 *   bun run db:codegen      # introspect it and rewrite this file
 */
import type { ColumnType, Generated } from 'kysely'

/** Written by the database (identity / defaults), never by the application. */
type ServerTimestamp = ColumnType<Date, Date | undefined, Date>

export interface TodosTable {
  id: Generated<number>
  title: string
  completed: ColumnType<boolean, boolean | undefined, boolean>
  createdAt: ColumnType<Date, Date | undefined, never>
  updatedAt: ServerTimestamp
}

export interface DB {
  todos: TodosTable
}
