import { Elysia } from 'elysia'
import { sql } from 'kysely'
import { API_PREFIX } from '../shared/constants'
import { createApi } from './app'
import { closeDatabase, getDatabase } from './db'
import { corsOrigins, env, isProduction } from './env'
import {
  createMemoryTodoRepository,
  createSqlTodoRepository,
  type TodoRecord,
} from './modules/todos/repository'
import { createTodoService } from './modules/todos/service'
import { loadAssets, staticPlugin } from './static'

/** Composition root: the one place that decides which implementations are used. */

const usingSql = env.DB_DRIVER === 'mssql'

const seed: TodoRecord[] = isProduction
  ? []
  : [
      {
        id: 1,
        title: 'Point DB_DRIVER at your local SQL Server',
        completed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

const repository = usingSql
  ? createSqlTodoRepository(getDatabase())
  : createMemoryTodoRepository(seed)

const checkReadiness = usingSql
  ? async () => {
      try {
        await sql`select 1`.execute(getDatabase())
        return true
      } catch (error) {
        console.error('[health] database unreachable', error)
        return false
      }
    }
  : async () => true

const api = createApi({
  todos: createTodoService(repository),
  checkReadiness,
  corsOrigins,
})

// In development Vite serves the SPA and proxies /api here; in production this
// process is the only thing in the container, so it serves both.
const assets = isProduction ? await loadAssets(env.CLIENT_DIR) : undefined

const root = new Elysia()
const server = (assets ? root.use(staticPlugin(assets, API_PREFIX)) : root)
  .use(api)
  .listen({ port: env.PORT, hostname: '0.0.0.0' })

console.log(
  `[server] listening on http://localhost:${env.PORT} ` +
    `(${env.NODE_ENV}, db=${env.DB_DRIVER}${assets ? `, ${assets.size} static assets` : ''})`,
)

/**
 * Containers are stopped with SIGTERM. Draining in-flight requests before the
 * process exits is what keeps a rolling deploy from dropping responses.
 */
let shuttingDown = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[server] ${signal} received, draining`)
    await server.stop()
    await closeDatabase()
    process.exit(0)
  })
}
