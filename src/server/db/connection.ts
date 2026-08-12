import { env } from '../env'

export interface MssqlConnection {
  server: string
  port: number
  database: string
  user: string
  password: string
  encrypt: boolean
  trustServerCertificate: boolean
}

const truthy = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : !/^(false|0|no)$/i.test(value.trim())

/**
 * ADO.NET form, which is what the Azure portal hands you:
 *
 *   Server=tcp:srv.database.windows.net,1433;Initial Catalog=db;
 *   User ID=user;Password=pw;Encrypt=True;TrustServerCertificate=False;
 *
 * This is the preferred form because `kysely-codegen` reads the same variable
 * and only understands this syntax.
 */
function parseAdoString(value: string, defaultPort: number): MssqlConnection {
  const pairs = new Map<string, string>()
  for (const segment of value.split(';')) {
    const index = segment.indexOf('=')
    if (index === -1) continue
    pairs.set(segment.slice(0, index).trim().toLowerCase(), segment.slice(index + 1).trim())
  }

  const get = (...keys: string[]) => keys.map((key) => pairs.get(key)).find(Boolean)

  // `tcp:host,1433` — the prefix and the port are both optional.
  const rawServer = (get('server', 'data source', 'address', 'addr', 'network address') ?? '')
    .replace(/^tcp:/i, '')
    .trim()
  const [host = '', port] = rawServer.split(',')

  return {
    server: host,
    port: port ? Number(port) : defaultPort,
    database: get('initial catalog', 'database') ?? '',
    user: get('user id', 'uid', 'user') ?? '',
    password: get('password', 'pwd') ?? '',
    encrypt: truthy(get('encrypt'), true),
    trustServerCertificate: truthy(get('trustservercertificate'), false),
  }
}

/** URL form: mssql://user:password@host:1433/database?encrypt=true */
function parseUrlString(value: string, defaultPort: number): MssqlConnection {
  const url = new URL(value)
  const flag = (name: string, fallback: boolean) =>
    truthy(url.searchParams.get(name) ?? undefined, fallback)

  return {
    server: url.hostname,
    port: url.port ? Number(url.port) : defaultPort,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    encrypt: flag('encrypt', true),
    trustServerCertificate: flag('trustServerCertificate', false),
  }
}

export function parseConnectionString(value: string, defaultPort = 1433): MssqlConnection {
  const connection = /^[a-z]+:\/\//i.test(value.trim())
    ? parseUrlString(value, defaultPort)
    : parseAdoString(value, defaultPort)

  const missing = (['server', 'database', 'user', 'password'] as const).filter(
    (key) => !connection[key],
  )
  if (missing.length > 0) {
    throw new Error(`Connection string is missing: ${missing.join(', ')}`)
  }
  if (!Number.isInteger(connection.port)) {
    throw new Error('Connection string has a non-numeric port')
  }

  return connection
}

/**
 * Accepts either a connection string (DATABASE_URL — usually a secret) or the
 * discrete DB_* variables, for platforms that inject configuration separately.
 */
export function resolveConnection(): MssqlConnection {
  if (env.DATABASE_URL) return parseConnectionString(env.DATABASE_URL, env.DB_PORT)

  const missing = (['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'] as const).filter(
    (key) => !env[key],
  )
  if (missing.length > 0) {
    throw new Error(`DB_DRIVER=mssql requires DATABASE_URL, or ${missing.join(', ')}`)
  }

  return {
    server: env.DB_SERVER as string,
    port: env.DB_PORT,
    database: env.DB_NAME as string,
    user: env.DB_USER as string,
    password: env.DB_PASSWORD as string,
    encrypt: env.DB_ENCRYPT,
    trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE,
  }
}
