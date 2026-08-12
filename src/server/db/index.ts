import { Kysely, MssqlDialect } from 'kysely'
import * as Tarn from 'tarn'
import * as Tedious from 'tedious'
import { env } from '../env'
import { resolveConnection } from './connection'
import type { DB } from './schema.generated'

export type Database = Kysely<DB>
export type { MssqlConnection } from './connection'
export { resolveConnection } from './connection'
export type { DB }

export function createDatabase(connection = resolveConnection()): Database {
  const dialect = new MssqlDialect({
    // tarn pools connections; tedious speaks TDS. Both are passed in rather
    // than bundled by Kysely, so there is exactly one copy of each.
    tarn: {
      ...Tarn,
      options: {
        min: env.DB_POOL_MIN,
        max: env.DB_POOL_MAX,
      },
    },
    tedious: {
      ...Tedious,
      connectionFactory: () =>
        new Tedious.Connection({
          server: connection.server,
          authentication: {
            type: 'default',
            options: { userName: connection.user, password: connection.password },
          },
          options: {
            database: connection.database,
            port: connection.port,
            // Azure SQL requires TLS.
            encrypt: connection.encrypt,
            trustServerCertificate: connection.trustServerCertificate,
            // Return native JS types rather than strings.
            useColumnNames: false,
            rowCollectionOnRequestCompletion: false,
            // Keep the driver from silently truncating large result sets.
            requestTimeout: 30_000,
            connectTimeout: 15_000,
          },
        }),
    },
  })

  return new Kysely<DB>({ dialect })
}

/** Opened lazily so `DB_DRIVER=memory` never dials a database. */
let instance: Database | undefined

export function getDatabase(): Database {
  if (!instance) instance = createDatabase()
  return instance
}

export async function closeDatabase(): Promise<void> {
  if (!instance) return
  const db = instance
  instance = undefined
  await db.destroy()
}
