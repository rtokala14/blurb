import "server-only"

import { applyAction, extractCreatedPrimaryKey, searchObjects } from "./client"
import { getFoundryConfig } from "./config"
import { normalizeEmail } from "./ontology"

/**
 * Per-request user resolution — port of the PoC's services/users.py.
 *
 * Production passes the signed-in user's email via the `x-alluvial-user-email`
 * header (injected by the upstream gateway). Localhost/dev falls back to the
 * configured ORBIT_USER_EMAIL so local sessions keep working. Users resolve
 * against the OrbitDocsUser ontology object and are auto-provisioned with
 * the PoC's defaults on first sight; inactive users are rejected.
 */

export const REQUEST_USER_HEADER = "x-alluvial-user-email"

const DEFAULT_DAILY_UPLOAD_LIMIT = 10
const DEFAULT_BONUS_UPLOAD_LIMIT = 0

/** email -> resolved row, cached to keep the check off the hot path. */
const USER_CACHE_TTL_MS = 5 * 60_000
const userCache = new Map<string, { at: number; row: OrbitUserRow | null }>()
const userInFlight = new Map<string, Promise<OrbitUserRow | null>>()

export class UserResolutionError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = "UserResolutionError"
  }
}

export interface OrbitUserRow {
  __primaryKey: string
  primaryKey_?: string
  email?: string
  name?: string
  isActive?: boolean
  isAdmin?: boolean
  featureFlags?: string[]
  hasUnlimitedUploads?: boolean
  dailyUploadLimit?: number
  bonusUploadLimit?: number
  bonusExpiresAt?: string
  bonusReason?: string
  createdAt?: string
  updatedAt?: string
}

export function deriveNameFromEmail(email: string): string {
  const local = normalizeEmail(email).split("@", 1)[0] ?? ""
  const tokens = local
    .replace(/[_-]/g, ".")
    .split(".")
    .filter(Boolean)
  if (tokens.length === 0) return "User"
  return tokens
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(" ")
}

async function findUserByEmail(email: string): Promise<OrbitUserRow | null> {
  // containsAllTerms is case-insensitive (the index lowercases terms); a
  // plain eq would miss a mixed-case row and auto-provision a duplicate
  // user with default limits — the classic "permission error".
  const rows = await searchObjects<OrbitUserRow>("OrbitDocsUser", {
    where: { type: "containsAllTerms", field: "email", value: email },
    pageSize: 10,
  })
  return rows.find((row) => normalizeEmail(row.email) === email) ?? null
}

async function createDefaultUser(email: string): Promise<void> {
  const timestamp = new Date().toISOString()
  try {
    const response = await applyAction(
      "create-orbit-docs-user",
      {
        email,
        name: deriveNameFromEmail(email),
        isAdmin: false,
        isActive: true,
        featureFlags: [],
        hasUnlimitedUploads: false,
        dailyUploadLimit: DEFAULT_DAILY_UPLOAD_LIMIT,
        bonusUploadLimit: DEFAULT_BONUS_UPLOAD_LIMIT,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { returnEdits: true }
    )
    extractCreatedPrimaryKey(response, "OrbitDocsUser")
  } catch (error) {
    // Legacy tenants expose the email param as "newParameter" (PoC fallback).
    const detail = error instanceof Error ? error.message : String(error)
    if (!/email|parameter/i.test(detail)) throw error
    await applyAction("create-orbit-docs-user", {
      newParameter: email,
      name: deriveNameFromEmail(email),
      isAdmin: false,
      isActive: true,
      featureFlags: [],
      hasUnlimitedUploads: false,
      dailyUploadLimit: DEFAULT_DAILY_UPLOAD_LIMIT,
      bonusUploadLimit: DEFAULT_BONUS_UPLOAD_LIMIT,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }
}

/** Provision-or-verify, cached with single-flight. Returns the user row. */
export async function getProvisionedUser(
  email: string
): Promise<OrbitUserRow | null> {
  const cached = userCache.get(email)
  if (cached && Date.now() - cached.at < USER_CACHE_TTL_MS) return cached.row
  const inFlight = userInFlight.get(email)
  if (inFlight) return inFlight

  const promise = (async () => {
    let user = await findUserByEmail(email)
    if (!user) {
      await createDefaultUser(email)
      user = await findUserByEmail(email)
    }
    userCache.set(email, { at: Date.now(), row: user })
    return user
  })().finally(() => userInFlight.delete(email))
  userInFlight.set(email, promise)
  return promise
}

/** Bust the cache after admin edits so changes take effect immediately. */
export function invalidateUserCache(email?: string): void {
  if (email) userCache.delete(normalizeEmail(email))
  else userCache.clear()
}

function isLocalHost(request: Request): boolean {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase()
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0"
}

function isDevMode(): boolean {
  return ["dev", "development", "local", "test"].includes(
    (process.env.NODE_ENV ?? "").toLowerCase()
  )
}

/**
 * Resolve the acting user's email for a request. Throws UserResolutionError
 * (401 missing identity / 403 inactive) — route handlers surface it via
 * errorResponse.
 */
export async function resolveRequestUser(request: Request): Promise<string> {
  const headerEmail = normalizeEmail(request.headers.get(REQUEST_USER_HEADER))
  let email = headerEmail
  if (!email) {
    if (isDevMode() || isLocalHost(request)) {
      email = getFoundryConfig().userEmail
    } else {
      throw new UserResolutionError("Missing user email header", 401)
    }
  }
  const user = await getProvisionedUser(email).catch(() => null)
  if (user && user.isActive === false) {
    throw new UserResolutionError("User is inactive", 403)
  }
  return email
}

/** Resolve and require an admin (PoC require_admin_user). */
export async function requireAdminUser(request: Request): Promise<{
  email: string
  user: OrbitUserRow
}> {
  const email = await resolveRequestUser(request)
  const user = await getProvisionedUser(email)
  if (!user || !user.isAdmin) {
    throw new UserResolutionError("Admin access required", 403)
  }
  return { email, user }
}
