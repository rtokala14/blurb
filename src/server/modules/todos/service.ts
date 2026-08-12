import type { CreateTodo, ListTodosQuery, Todo, TodoPage, UpdateTodo } from './model'
import type { TodoRecord, TodoRepository } from './repository'

/** Thrown for a cursor the client did not get from us. */
export class InvalidCursorError extends Error {
  constructor() {
    super('Malformed pagination cursor')
  }
}

function toDto(record: TodoRecord): Todo {
  return {
    id: record.id,
    title: record.title,
    completed: record.completed,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function encodeCursor(record: TodoRecord): string {
  return Buffer.from(`${record.createdAt.toISOString()}|${record.id}`).toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: Date; id: number } {
  const [iso, rawId] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  const createdAt = new Date(iso ?? '')
  const id = Number(rawId)
  if (Number.isNaN(createdAt.getTime()) || !Number.isInteger(id)) throw new InvalidCursorError()
  return { createdAt, id }
}

/**
 * Application logic for todos. Depends on the repository interface only, so it
 * is exercised in tests against the in-memory driver at full speed.
 */
export function createTodoService(repository: TodoRepository) {
  return {
    async list(query: ListTodosQuery): Promise<TodoPage> {
      // Fetch one extra row to learn whether another page exists without a
      // second COUNT query.
      const records = await repository.list({
        limit: query.limit + 1,
        completed: query.completed,
        after: query.cursor ? decodeCursor(query.cursor) : undefined,
      })

      const hasMore = records.length > query.limit
      const page = hasMore ? records.slice(0, query.limit) : records
      const last = page.at(-1)

      return {
        items: page.map(toDto),
        ...(hasMore && last ? { nextCursor: encodeCursor(last) } : {}),
      }
    },

    async get(id: number): Promise<Todo | undefined> {
      const record = await repository.findById(id)
      return record && toDto(record)
    },

    async create(input: CreateTodo): Promise<Todo> {
      return toDto(await repository.create({ title: input.title.trim() }))
    },

    async update(id: number, patch: UpdateTodo): Promise<Todo | undefined> {
      const record = await repository.update(id, {
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
      })
      return record && toDto(record)
    },

    async remove(id: number): Promise<boolean> {
      return repository.remove(id)
    },
  }
}

export type TodoService = ReturnType<typeof createTodoService>
