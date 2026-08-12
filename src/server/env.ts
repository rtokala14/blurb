import { Value } from '@sinclair/typebox/value'
import { t } from 'elysia'

/**
 * Environment is parsed once, at import time, and fails loudly.
 * A container that is missing configuration should die on boot, not on the
 * first request that happens to touch the database.
 */

const EnvSchema = t.Object({
  NODE_ENV: t.Union([t.Literal('development'), t.Literal('test'), t.Literal('production')], {
    default: 'development',
  }),
  PORT: t.Integer({ minimum: 1, maximum: 65535, default: 3000 }),
  /** Directory holding the built SPA. Ignored in development (Vite serves it). */
  CLIENT_DIR: t.String({ default: 'dist/client' }),
  /** Comma-separated allow-list. Empty means same-origin only, which is the deployed shape. */
  CORS_ORIGINS: t.String({ default: '' }),
  DB_DRIVER: t.Union([t.Literal('memory'), t.Literal('mssql')], { default: 'memory' }),
  DATABASE_URL: t.Optional(t.String()),
  DB_SERVER: t.Optional(t.String()),
  DB_PORT: t.Integer({ minimum: 1, maximum: 65535, default: 1433 }),
  DB_NAME: t.Optional(t.String()),
  DB_USER: t.Optional(t.String()),
  DB_PASSWORD: t.Optional(t.String()),
  DB_ENCRYPT: t.Boolean({ default: true }),
  DB_TRUST_SERVER_CERTIFICATE: t.Boolean({ default: false }),
  DB_POOL_MIN: t.Integer({ minimum: 0, default: 0 }),
  DB_POOL_MAX: t.Integer({ minimum: 1, default: 10 }),
})

function parseEnv(source: Record<string, string | undefined>) {
  // Drop empty strings so schema defaults win over `FOO=` in a .env file.
  const raw: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') raw[key] = value
  }

  // Convert/Default coerce "3000" -> 3000 and "true" -> true using the schema.
  const candidate = Value.Default(EnvSchema, Value.Convert(EnvSchema, raw))
  const errors = [...Value.Errors(EnvSchema, candidate)]
  if (errors.length > 0) {
    const detail = errors.map((e) => `  ${e.path || '/'}: ${e.message}`).join('\n')
    throw new Error(`Invalid environment:\n${detail}`)
  }
  return candidate as typeof EnvSchema.static
}

export const env = parseEnv(process.env)

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean)

export type Env = typeof env
