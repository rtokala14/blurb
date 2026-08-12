import { Elysia, status, t } from 'elysia'
import {
  CreateTodo,
  ErrorResponse,
  ListTodosQuery,
  Todo,
  TodoPage,
  TodoParams,
  UpdateTodo,
} from './model'
import type { TodoService } from './service'

const notFound = (id: number) =>
  status(404, { error: 'not_found', message: `Todo ${id} does not exist` })

/**
 * Routes are a thin transport layer: validate, delegate, map to a status code.
 * The service is injected so tests and the memory driver need no globals.
 */
export const todoRoutes = (service: TodoService) =>
  new Elysia({ prefix: '/todos', name: 'todos' })
    .get('/', ({ query }) => service.list(query), {
      query: ListTodosQuery,
      response: { 200: TodoPage, 400: ErrorResponse },
      detail: { summary: 'List todos (keyset paginated)' },
    })

    .get('/:id', async ({ params }) => (await service.get(params.id)) ?? notFound(params.id), {
      params: TodoParams,
      response: { 200: Todo, 404: ErrorResponse },
    })

    .post(
      '/',
      async ({ body, set }) => {
        set.status = 201
        return service.create(body)
      },
      {
        body: CreateTodo,
        response: { 201: Todo, 400: ErrorResponse },
      },
    )

    .patch(
      '/:id',
      async ({ params, body }) => (await service.update(params.id, body)) ?? notFound(params.id),
      {
        params: TodoParams,
        body: UpdateTodo,
        response: { 200: Todo, 400: ErrorResponse, 404: ErrorResponse },
      },
    )

    .delete(
      '/:id',
      async ({ params, set }) => {
        const removed = await service.remove(params.id)
        if (!removed) return notFound(params.id)
        set.status = 204
        return undefined
      },
      {
        params: TodoParams,
        response: { 204: t.Void(), 404: ErrorResponse },
      },
    )
