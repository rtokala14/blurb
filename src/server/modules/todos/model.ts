import { t } from 'elysia'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../shared/constants'

/**
 * The API contract, written once in TypeBox.
 *
 * Elysia compiles these into JIT validators for runtime checking, and Eden
 * lifts the exact same types into the browser — so the client cannot drift
 * from the server without a type error.
 */

export const Todo = t.Object({
  id: t.Integer(),
  title: t.String(),
  completed: t.Boolean(),
  /** ISO-8601. Serialised as a string so the client type matches the wire. */
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
})

export const TodoPage = t.Object({
  items: t.Array(Todo),
  /** Opaque keyset cursor; absent when there is no further page. */
  nextCursor: t.Optional(t.String()),
})

export const ListTodosQuery = t.Object({
  limit: t.Integer({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE }),
  cursor: t.Optional(t.String()),
  completed: t.Optional(t.Boolean()),
})

export const CreateTodo = t.Object({
  title: t.String({ minLength: 1, maxLength: 200 }),
})

export const UpdateTodo = t.Object({
  title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  completed: t.Optional(t.Boolean()),
})

export const TodoParams = t.Object({
  id: t.Integer({ minimum: 1 }),
})

export const ErrorResponse = t.Object({
  error: t.String(),
  message: t.String(),
})

export type Todo = typeof Todo.static
export type TodoPage = typeof TodoPage.static
export type ListTodosQuery = typeof ListTodosQuery.static
export type CreateTodo = typeof CreateTodo.static
export type UpdateTodo = typeof UpdateTodo.static
