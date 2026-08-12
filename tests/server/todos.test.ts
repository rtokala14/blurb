import { beforeEach, describe, expect, it } from 'bun:test'
import { createApi } from '../../src/server/app'
import { createMemoryTodoRepository } from '../../src/server/modules/todos/repository'
import { createTodoService } from '../../src/server/modules/todos/service'

/**
 * Routes are exercised through the real Elysia instance via `app.handle`, so
 * validation, serialisation and status codes are all covered — but with the
 * in-memory repository, so the suite needs no database and stays fast.
 */
function createTestApi() {
  return createApi({
    todos: createTodoService(createMemoryTodoRepository()),
    checkReadiness: async () => true,
  })
}

let api: ReturnType<typeof createTestApi>

const json = (path: string, init?: RequestInit) =>
  api.handle(new Request(`http://localhost${path}`, init))

const post = (path: string, body: unknown) =>
  json(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  api = createTestApi()
})

describe('health', () => {
  it('reports liveness without touching dependencies', async () => {
    const response = await json('/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok' })
  })

  it('returns 503 when a dependency is down', async () => {
    const degraded = createApi({
      todos: createTodoService(createMemoryTodoRepository()),
      checkReadiness: async () => false,
    })
    const response = await degraded.handle(new Request('http://localhost/api/health/ready'))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ready: false })
  })
})

describe('POST /api/todos', () => {
  it('creates a todo and returns 201', async () => {
    const response = await post('/api/todos', { title: 'write the migration' })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      id: 1,
      title: 'write the migration',
      completed: false,
    })
  })

  it('rejects an empty title with a readable message', async () => {
    const response = await post('/api/todos', { title: '' })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string; message: string }
    expect(body.error).toBe('validation_failed')
    expect(body.message).toContain('title')
  })

  it('rejects a title over the column length', async () => {
    const response = await post('/api/todos', { title: 'x'.repeat(201) })
    expect(response.status).toBe(400)
  })
})

describe('GET /api/todos', () => {
  it('paginates by cursor without repeating or skipping rows', async () => {
    for (const title of ['one', 'two', 'three']) await post('/api/todos', { title })

    const first = (await (await json('/api/todos?limit=2')).json()) as {
      items: { id: number }[]
      nextCursor?: string
    }
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).toBeString()

    const second = (await (
      await json(`/api/todos?limit=2&cursor=${encodeURIComponent(first.nextCursor as string)}`)
    ).json()) as { items: { id: number }[]; nextCursor?: string }

    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeUndefined()

    const ids = [...first.items, ...second.items].map((item) => item.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('filters by completion state', async () => {
    await post('/api/todos', { title: 'done soon' })
    await json('/api/todos/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    })
    await post('/api/todos', { title: 'still open' })

    const completed = (await (await json('/api/todos?completed=true')).json()) as {
      items: { title: string }[]
    }
    expect(completed.items.map((item) => item.title)).toEqual(['done soon'])
  })

  it('rejects a limit above the maximum', async () => {
    expect((await json('/api/todos?limit=1000')).status).toBe(400)
  })

  it('rejects a corrupt cursor', async () => {
    expect((await json('/api/todos?cursor=not-a-cursor')).status).toBe(400)
  })
})

describe('mutations on a missing todo', () => {
  it('404s on read, patch and delete', async () => {
    expect((await json('/api/todos/999')).status).toBe(404)
    expect(
      (
        await json('/api/todos/999', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ completed: true }),
        })
      ).status,
    ).toBe(404)
    expect((await json('/api/todos/999', { method: 'DELETE' })).status).toBe(404)
  })
})

describe('DELETE /api/todos/:id', () => {
  it('removes the todo and returns 204', async () => {
    await post('/api/todos', { title: 'temporary' })
    expect((await json('/api/todos/1', { method: 'DELETE' })).status).toBe(204)
    expect((await json('/api/todos/1')).status).toBe(404)
  })
})
