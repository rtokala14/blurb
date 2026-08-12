import type { Database } from '../../db'

/** A row as it exists in storage — dates are Date objects, not strings. */
export interface TodoRecord {
  id: number
  title: string
  completed: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ListParams {
  limit: number
  completed?: boolean | undefined
  /** Keyset position: return rows strictly older than this. */
  after?: { createdAt: Date; id: number } | undefined
}

/**
 * Every storage concern sits behind this interface. Routes and services depend
 * on it, never on Kysely — which is what makes the in-memory driver possible
 * and what would keep a swap to another data layer contained to one file.
 */
export interface TodoRepository {
  list(params: ListParams): Promise<TodoRecord[]>
  findById(id: number): Promise<TodoRecord | undefined>
  create(input: { title: string }): Promise<TodoRecord>
  update(
    id: number,
    patch: { title?: string; completed?: boolean },
  ): Promise<TodoRecord | undefined>
  remove(id: number): Promise<boolean>
}

const COLUMNS = ['id', 'title', 'completed', 'createdAt', 'updatedAt'] as const

export function createSqlTodoRepository(db: Database): TodoRepository {
  return {
    async list({ limit, completed, after }) {
      let query = db
        .selectFrom('todos')
        .select(COLUMNS)
        // Matches IX_todos_createdAt, so this is an index scan with no sort.
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .top(limit)

      if (completed !== undefined) query = query.where('completed', '=', completed)

      if (after) {
        // Keyset paging: no OFFSET, so page 1000 costs the same as page 1.
        query = query.where((eb) =>
          eb.or([
            eb('createdAt', '<', after.createdAt),
            eb.and([eb('createdAt', '=', after.createdAt), eb('id', '<', after.id)]),
          ]),
        )
      }

      return query.execute()
    },

    async findById(id) {
      return db.selectFrom('todos').select(COLUMNS).where('id', '=', id).executeTakeFirst()
    },

    async create({ title }) {
      // OUTPUT returns the inserted row in the same round trip.
      const row = await db
        .insertInto('todos')
        .values({ title })
        .outputAll('inserted')
        .executeTakeFirstOrThrow()
      return row
    },

    async update(id, patch) {
      const changes = {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
      }
      if (Object.keys(changes).length === 0) return this.findById(id)

      return db
        .updateTable('todos')
        .set({ ...changes, updatedAt: new Date() })
        .outputAll('inserted')
        .where('id', '=', id)
        .executeTakeFirst()
    },

    async remove(id) {
      const result = await db.deleteFrom('todos').where('id', '=', id).executeTakeFirst()
      return result.numDeletedRows > 0n
    },
  }
}

/**
 * Zero-dependency driver so `bun dev` and `bun test` run with no database.
 * Behaviour — ordering, keyset paging, timestamps — mirrors the SQL driver.
 */
export function createMemoryTodoRepository(seed: TodoRecord[] = []): TodoRepository {
  const rows = new Map<number, TodoRecord>(seed.map((row) => [row.id, row]))
  let nextId = seed.reduce((max, row) => Math.max(max, row.id), 0) + 1

  const ordered = () =>
    [...rows.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)

  return {
    async list({ limit, completed, after }) {
      let items = ordered()
      if (completed !== undefined) items = items.filter((row) => row.completed === completed)
      if (after) {
        items = items.filter(
          (row) =>
            row.createdAt < after.createdAt ||
            (row.createdAt.getTime() === after.createdAt.getTime() && row.id < after.id),
        )
      }
      return items.slice(0, limit)
    },

    async findById(id) {
      return rows.get(id)
    },

    async create({ title }) {
      const now = new Date()
      const row: TodoRecord = {
        id: nextId++,
        title,
        completed: false,
        createdAt: now,
        updatedAt: now,
      }
      rows.set(row.id, row)
      return row
    },

    async update(id, patch) {
      const existing = rows.get(id)
      if (!existing) return undefined
      const updated: TodoRecord = {
        ...existing,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
        updatedAt: new Date(),
      }
      rows.set(id, updated)
      return updated
    },

    async remove(id) {
      return rows.delete(id)
    },
  }
}
