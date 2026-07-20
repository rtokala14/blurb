import "server-only"

import { applyAction, getObject, searchObjects } from "./client"
import { getFoundryConfig } from "./config"
import { normalizeEmail, parseOptions } from "./ontology"

/**
 * Per-request user resolution against the v3 OrbitDocsUserV2 object
 * (primary key = email).
 *
 * Production passes the signed-in user's email via the `x-alluvial-user-email`
 * header (injected by the upstream gateway). Localhost/dev falls back to the
 * configured ORBIT_USER_EMAIL so local sessions keep working. Users are
 * auto-provisioned on first sight per the v3 integration contract
 * (role="user", isOnboarded=false, isAllowedToUpload=false).
 *
 * App-specific preferences (chat folders, etc.) live in the user's free-form
 * `options` JSON so no schema change is ever needed for new toggles.
 */

export const REQUEST_USER_HEADER = "x-alluvial-user-email"

export const DEFAULT_DAILY_UPLOAD_LIMIT = 10

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
  __primaryKey?: string
  email?: string
  name?: string
  role?: string
  isOnboarded?: boolean
  isAllowedToUpload?: boolean
  dailyUploadLimit?: string | number
  options?: string
  createdAt?: string
  updatedAt?: string
}

export function isAdminUser(user: OrbitUserRow | null | undefined): boolean {
  return (user?.role ?? "").toLowerCase() === "admin"
}

export function userDailyLimit(user: OrbitUserRow): number {
  const value = Number(user.dailyUploadLimit ?? DEFAULT_DAILY_UPLOAD_LIMIT)
  return Number.isFinite(value) ? value : DEFAULT_DAILY_UPLOAD_LIMIT
}

/** App-specific prefs kept in the user's free-form options JSON. */
export interface UserOptions {
  chatFolders?: { id: string; name: string; color?: string | null }[]
  [key: string]: unknown
}

export function userOptions(user: OrbitUserRow): UserOptions {
  return parseOptions<UserOptions>(user.options)
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
  // PK = email, so try the direct read first. Fall back to a case-insensitive
  // search (containsAllTerms lowercases terms) in case the row was stored
  // with different casing — provisioning a duplicate would split limits.
  const direct = await getObject<OrbitUserRow>("OrbitDocsUserV2", email)
  if (direct) return direct
  const rows = await searchObjects<OrbitUserRow>("OrbitDocsUserV2", {
    where: { type: "containsAllTerms", field: "email", value: email },
    pageSize: 10,
  })
  return rows.find((row) => normalizeEmail(row.email) === email) ?? null
}

async function createDefaultUser(email: string): Promise<void> {
  const timestamp = new Date().toISOString()
  // Note: the generated OpenAPI omits `email`, but the action requires it
  // (verified live via VALIDATE_ONLY).
  await applyAction("create-orbit-docs-v3-user", {
    email,
    name: deriveNameFromEmail(email),
    role: "user",
    isOnboarded: false,
    isAllowedToUpload: false,
    dailyUploadLimit: DEFAULT_DAILY_UPLOAD_LIMIT,
    options: "{}",
    createdAt: timestamp,
    updatedAt: timestamp,
  })
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

/**
 * Full-replay edit of a user row (edit-orbit-docs-v3-user). The object
 * reference parameter is named OrbitDocsUser (not ...V2) per the spec.
 */
export async function updateUserRow(
  user: OrbitUserRow,
  fields: Partial<{
    name: string
    role: string
    isOnboarded: boolean
    isAllowedToUpload: boolean
    dailyUploadLimit: number
    options: UserOptions
  }>
): Promise<void> {
  const email = normalizeEmail(user.email)
  const mergedOptions = fields.options
    ? { ...userOptions(user), ...fields.options }
    : userOptions(user)
  await applyAction("edit-orbit-docs-v3-user", {
    OrbitDocsUser: String(user.__primaryKey ?? user.email ?? ""),
    name: fields.name ?? user.name ?? deriveNameFromEmail(email),
    role: fields.role ?? user.role ?? "user",
    isOnboarded: fields.isOnboarded ?? user.isOnboarded ?? false,
    isAllowedToUpload:
      fields.isAllowedToUpload ?? user.isAllowedToUpload ?? false,
    dailyUploadLimit: fields.dailyUploadLimit ?? userDailyLimit(user),
    options: JSON.stringify(mergedOptions),
    createdAt: user.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  invalidateUserCache(email)
}

/** Bust the cache after admin edits so changes take effect immediately. */
export function invalidateUserCache(email?: string): void {
  if (email) userCache.delete(normalizeEmail(email))
  else userCache.clear()
}

export async function listAllUsers(): Promise<OrbitUserRow[]> {
  return searchObjects<OrbitUserRow>("OrbitDocsUserV2", {
    pageSize: 1000,
    maxItems: 10_000,
  })
}

/* ------------------------------------------------------------------ */
/* Chat folders (stored in user options JSON — no v3 object type)       */
/* ------------------------------------------------------------------ */

export interface ChatFolderPref {
  id: string
  name: string
  color?: string | null
}

export const CHAT_FOLDER_COLORS = [
  "slate",
  "sky",
  "indigo",
  "teal",
  "emerald",
  "amber",
  "rose",
]

export function normalizeChatFolderColor(
  color: string | null | undefined
): string | null {
  if (!color) return null
  const normalized = color.trim().toLowerCase()
  if (!CHAT_FOLDER_COLORS.includes(normalized)) {
    throw new UserResolutionError(`Invalid chat folder color: ${color}`, 422)
  }
  return normalized
}

export function listChatFolders(user: OrbitUserRow): ChatFolderPref[] {
  const folders = userOptions(user).chatFolders
  return Array.isArray(folders)
    ? folders.filter((f) => f && typeof f.id === "string" && f.id)
    : []
}

export async function saveChatFolders(
  user: OrbitUserRow,
  folders: ChatFolderPref[]
): Promise<void> {
  await updateUserRow(user, { options: { chatFolders: folders } })
}

export function serializeChatFolder(folder: ChatFolderPref) {
  return {
    primaryKey: folder.id,
    name: folder.name,
    color: CHAT_FOLDER_COLORS.includes(folder.color ?? "")
      ? folder.color
      : null,
    createdBy: "",
    updatedAt: null as string | null,
  }
}

/* ------------------------------------------------------------------ */
/* Request resolution                                                   */
/* ------------------------------------------------------------------ */

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
 * (401 missing identity) — route handlers surface it via errorResponse.
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
  // Warm/provision; resolution failures shouldn't block reads.
  await getProvisionedUser(email).catch(() => null)
  return email
}

/** Resolve and require an admin (role === "admin"). */
export async function requireAdminUser(request: Request): Promise<{
  email: string
  user: OrbitUserRow
}> {
  const email = await resolveRequestUser(request)
  const user = await getProvisionedUser(email)
  if (!user || !isAdminUser(user)) {
    throw new UserResolutionError("Admin access required", 403)
  }
  return { email, user }
}
