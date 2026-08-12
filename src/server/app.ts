import { Elysia } from 'elysia'
import { API_PREFIX } from '../shared/constants'
import { cors } from './lib/cors'
import { healthRoutes } from './modules/health/routes'
import { todoRoutes } from './modules/todos/routes'
import type { TodoService } from './modules/todos/service'
import { InvalidCursorError } from './modules/todos/service'

export interface AppDependencies {
  todos: TodoService
  checkReadiness: () => Promise<boolean>
  corsOrigins?: string[]
}

/**
 * The HTTP API.
 *
 * `createApi` returns the Elysia instance and `Api` is its type — that type is
 * the entire RPC contract. The browser imports it with `import type`, so not a
 * byte of server code reaches the client bundle, yet every route, parameter and
 * response shape is checked at compile time on both sides.
 */
export const createApi = ({ todos, checkReadiness, corsOrigins = [] }: AppDependencies) =>
  new Elysia({
    prefix: API_PREFIX,
    // Build all validators up front rather than on first hit, so the first
    // request after a cold start is not the slow one.
    precompile: true,
  })
    .use(cors(corsOrigins))
    .onError(({ code, error, set }) => {
      if (error instanceof InvalidCursorError) {
        set.status = 400
        return { error: 'invalid_cursor', message: error.message }
      }

      switch (code) {
        case 'VALIDATION': {
          // Elysia's default message is the full validator dump; surface the
          // first failure instead so clients get something actionable.
          const first = error.all?.[0]
          const detail =
            first && 'summary' in first && first.summary
              ? `${first.path ?? ''} ${first.summary}`.trim()
              : 'Request failed validation'
          set.status = 400
          return { error: 'validation_failed', message: detail }
        }
        case 'NOT_FOUND':
          set.status = 404
          return { error: 'not_found', message: 'Route does not exist' }
        case 'PARSE':
          set.status = 400
          return { error: 'malformed_request', message: 'Request body could not be parsed' }
        default:
          // Log the detail, return none: internal errors are not a client concern.
          console.error('[api] unhandled error', error)
          set.status = 500
          return { error: 'internal_error', message: 'Something went wrong' }
      }
    })
    .use(healthRoutes({ checkReadiness }))
    .use(todoRoutes(todos))

export type Api = ReturnType<typeof createApi>
