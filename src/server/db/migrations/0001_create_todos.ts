import { type Kysely, sql } from 'kysely'

/**
 * Column naming matches the TypeScript field names exactly, so nothing has to
 * be mapped at runtime and generated types need no case plugin.
 *
 * The primary key is a monotonically increasing identity rather than a random
 * GUID: SQL Server clusters on the PK, and random keys cause page splits and
 * index fragmentation on every insert. If you need a non-enumerable public
 * identifier, add a separate `publicId UNIQUEIDENTIFIER DEFAULT NEWSEQUENTIALID()`
 * column with its own non-clustered unique index.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('todos')
    .addColumn('id', 'integer', (col) => col.identity().primaryKey().notNull())
    .addColumn('title', sql`nvarchar(200)`, (col) => col.notNull())
    .addColumn('completed', 'boolean', (col) => col.notNull().defaultTo(sql`0`))
    .addColumn('createdAt', sql`datetime2(3)`, (col) =>
      col.notNull().defaultTo(sql`sysutcdatetime()`),
    )
    .addColumn('updatedAt', sql`datetime2(3)`, (col) =>
      col.notNull().defaultTo(sql`sysutcdatetime()`),
    )
    .execute()

  // Supports the default listing order without a sort operator.
  await db.schema
    .createIndex('IX_todos_createdAt')
    .on('todos')
    .columns(['createdAt desc', 'id desc'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('IX_todos_createdAt').on('todos').execute()
  await db.schema.dropTable('todos').execute()
}
