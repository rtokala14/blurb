import "server-only"

import { getFoundryConfig } from "./config"
import { getFoundryToken } from "./token"

/**
 * Minimal Foundry REST client built directly on the platform openapi.yml —
 * no SDK. Covers ontology object search/get, action apply, query execute,
 * AIP agent sessions (create/stream/trace), and media set content.
 */

export class FoundryError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string
  ) {
    super(message)
    this.name = "FoundryError"
  }
}

async function authHeaders(extra?: Record<string, string>) {
  const token = await getFoundryToken()
  return { Authorization: `Bearer ${token}`, ...extra }
}

export async function foundryFetch(
  path: string,
  init: RequestInit & { searchParams?: Record<string, string> } = {}
): Promise<Response> {
  const cfg = getFoundryConfig()
  const url = new URL(`${cfg.hostname}${path}`)
  for (const [key, value] of Object.entries(init.searchParams ?? {})) {
    url.searchParams.set(key, value)
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(await authHeaders()),
      ...(init.body && typeof init.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
    cache: "no-store",
  })
  return res
}

export async function foundryJson<T>(
  path: string,
  init: RequestInit & { searchParams?: Record<string, string> } = {}
): Promise<T> {
  const res = await foundryFetch(path, init)
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new FoundryError(
      `Foundry ${init.method ?? "GET"} ${path} failed (${res.status})`,
      res.status,
      detail.slice(0, 2000)
    )
  }
  return (await res.json()) as T
}

/* ------------------------------------------------------------------ */
/* Ontology: objects                                                    */
/* ------------------------------------------------------------------ */

export type WhereClause =
  | { type: "eq"; field: string; value: unknown }
  | { type: "gte"; field: string; value: unknown }
  | { type: "in"; field: string; value: unknown[] }
  | { type: "contains"; field: string; value: unknown }
  | { type: "containsAllTerms"; field: string; value: string }
  | { type: "containsAnyTerm"; field: string; value: string }
  | { type: "containsAllTermsInOrder"; field: string; value: string }
  | { type: "and"; value: WhereClause[] }
  | { type: "or"; value: WhereClause[] }
  | { type: "not"; value: WhereClause }

export interface SearchOptions {
  where?: WhereClause
  pageSize?: number
  pageToken?: string
  /** project only these properties (major payload win on large tables) */
  select?: string[]
  orderBy?: { fields: { field: string; direction: "asc" | "desc" }[] }
}

interface SearchResponse<T> {
  data: T[]
  nextPageToken?: string
}

export async function searchObjectsPage<T = Record<string, unknown>>(
  objectType: string,
  options: SearchOptions = {}
): Promise<SearchResponse<T>> {
  const cfg = getFoundryConfig()
  const body: Record<string, unknown> = {
    pageSize: options.pageSize ?? 1000,
  }
  if (options.where) body.where = options.where
  if (options.pageToken) body.pageToken = options.pageToken
  if (options.select) body.select = options.select
  if (options.orderBy) body.orderBy = options.orderBy
  return foundryJson<SearchResponse<T>>(
    `/api/v2/ontologies/${cfg.ontology}/objects/${objectType}/search`,
    { method: "POST", body: JSON.stringify(body) }
  )
}

/** Search with automatic pagination (bounded by maxItems). */
export async function searchObjects<T = Record<string, unknown>>(
  objectType: string,
  options: SearchOptions & { maxItems?: number } = {}
): Promise<T[]> {
  const max = options.maxItems ?? 10_000
  const out: T[] = []
  let pageToken: string | undefined
  do {
    const page = await searchObjectsPage<T>(objectType, { ...options, pageToken })
    out.push(...page.data)
    pageToken = page.nextPageToken
  } while (pageToken && out.length < max)
  return out.slice(0, max)
}

export async function getObject<T = Record<string, unknown>>(
  objectType: string,
  primaryKey: string
): Promise<T | null> {
  const cfg = getFoundryConfig()
  const res = await foundryFetch(
    `/api/v2/ontologies/${cfg.ontology}/objects/${objectType}/${encodeURIComponent(primaryKey)}`
  )
  if (res.status === 404) return null
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new FoundryError(
      `Foundry GET ${objectType}/${primaryKey} failed (${res.status})`,
      res.status,
      detail.slice(0, 2000)
    )
  }
  return (await res.json()) as T
}

/** Foundry caps `in` filter cardinality; chunk under it (matches PoC). */
export const IN_FILTER_CHUNK = 100

export async function getObjectsByIds<T = Record<string, unknown>>(
  objectType: string,
  primaryKeyField: string,
  ids: string[]
): Promise<Map<string, T>> {
  const found = new Map<string, T>()
  const unique = [...new Set(ids.filter(Boolean))]
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += IN_FILTER_CHUNK) {
    chunks.push(unique.slice(i, i + IN_FILTER_CHUNK))
  }
  const pages = await Promise.all(
    chunks.map((chunk) =>
      searchObjects<T>(objectType, {
        where: { type: "in", field: primaryKeyField, value: chunk },
      })
    )
  )
  for (const row of pages.flat()) {
    const pk = String(
      (row as Record<string, unknown>)[primaryKeyField] ??
        (row as Record<string, unknown>).__primaryKey ??
        ""
    )
    if (pk) found.set(pk, row)
  }
  return found
}

/* ------------------------------------------------------------------ */
/* Ontology: actions & queries                                          */
/* ------------------------------------------------------------------ */

interface ActionEdits {
  edits?: {
    edits?: { type: string; objectType?: string; primaryKey?: unknown }[]
  }
}

/**
 * Apply an ontology action (kebab-case api name, e.g.
 * "create-orbit-docs-user-sessions").
 */
export async function applyAction<T = ActionEdits>(
  actionApiName: string,
  parameters: Record<string, unknown>,
  { returnEdits = false }: { returnEdits?: boolean } = {}
): Promise<T> {
  const cfg = getFoundryConfig()
  // Foundry rejects explicit nulls for omitted params — strip undefined/null.
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined) cleaned[key] = value
  }
  return foundryJson<T>(
    `/api/v2/ontologies/${cfg.ontology}/actions/${actionApiName}/apply`,
    {
      method: "POST",
      body: JSON.stringify({
        parameters: cleaned,
        options: { returnEdits: returnEdits ? "ALL" : "NONE" },
      }),
    }
  )
}

/** Extract the created primary key from an apply-with-edits response. */
export function extractCreatedPrimaryKey(
  response: ActionEdits,
  objectType: string
): string {
  for (const edit of response.edits?.edits ?? []) {
    if (edit.type !== "addObject") continue
    if (edit.objectType !== objectType) continue
    return String(edit.primaryKey ?? "")
  }
  throw new Error(`Failed to extract created primary key for ${objectType}`)
}

export async function executeQuery<T = unknown>(
  queryApiName: string,
  parameters: Record<string, unknown>
): Promise<T> {
  const cfg = getFoundryConfig()
  return foundryJson<T>(
    `/api/v2/ontologies/${cfg.ontology}/queries/${queryApiName}/execute`,
    { method: "POST", body: JSON.stringify({ parameters }) }
  )
}

/* ------------------------------------------------------------------ */
/* AIP Agents                                                           */
/* ------------------------------------------------------------------ */

export interface AipSession {
  rid: string
  agentVersion?: string
}

export async function createAipSession(
  agentRid: string,
  agentVersion?: string | null
): Promise<AipSession> {
  try {
    return await foundryJson<AipSession>(
      `/api/v2/aipAgents/agents/${agentRid}/sessions`,
      {
        method: "POST",
        searchParams: { preview: "true" },
        body: JSON.stringify(agentVersion ? { agentVersion } : {}),
      }
    )
  } catch (error) {
    // Pinned version may have been deleted — retry on latest (matches PoC).
    if (
      agentVersion &&
      error instanceof FoundryError &&
      (error.detail?.includes("AgentVersionNotFound") || error.status === 404)
    ) {
      return foundryJson<AipSession>(
        `/api/v2/aipAgents/agents/${agentRid}/sessions`,
        {
          method: "POST",
          searchParams: { preview: "true" },
          body: JSON.stringify({}),
        }
      )
    }
    throw error
  }
}

export interface StreamingContinueInput {
  agentRid: string
  sessionRid: string
  userInput: string
  parameterInputs?: Record<string, unknown>
  messageId: string
  sessionTraceId: string
}

/**
 * Stream an agent turn. Returns the raw byte stream of markdown text —
 * passed straight through to the browser with zero re-buffering.
 */
export async function streamingContinue(
  input: StreamingContinueInput
): Promise<Response> {
  const payload: Record<string, unknown> = {
    userInput: { text: input.userInput },
    messageId: input.messageId,
    sessionTraceId: input.sessionTraceId,
  }
  if (input.parameterInputs && Object.keys(input.parameterInputs).length > 0) {
    payload.parameterInputs = input.parameterInputs
  }
  return foundryFetch(
    `/api/v2/aipAgents/agents/${input.agentRid}/sessions/${input.sessionRid}/streamingContinue`,
    {
      method: "POST",
      searchParams: { preview: "true" },
      headers: { Accept: "application/octet-stream" },
      body: JSON.stringify(payload),
    }
  )
}

export async function getSessionTrace(
  agentRid: string,
  sessionRid: string,
  traceId: string
): Promise<
  | ({ status?: string } & import("./turn").RawSessionTrace)
  | null
> {
  try {
    return await foundryJson(
      `/api/v2/aipAgents/agents/${agentRid}/sessions/${sessionRid}/sessionTraces/${traceId}`,
      { searchParams: { preview: "true" } }
    )
  } catch {
    return null
  }
}

export async function getAipSessionContent(
  agentRid: string,
  sessionRid: string
): Promise<{
  exchanges?: { result?: { agentMarkdownResponse?: string } }[]
} | null> {
  try {
    return await foundryJson(
      `/api/v2/aipAgents/agents/${agentRid}/sessions/${sessionRid}/content`,
      { searchParams: { preview: "true" } }
    )
  } catch {
    return null
  }
}

export async function getAgent(agentRid: string): Promise<{
  rid: string
  version?: string
  metadata?: {
    displayName?: string
    description?: string
    inputPlaceholder?: string
    suggestedPrompts?: string[]
  }
}> {
  return foundryJson(`/api/v2/aipAgents/agents/${agentRid}`, {
    searchParams: { preview: "true" },
  })
}

/* ------------------------------------------------------------------ */
/* Media sets                                                           */
/* ------------------------------------------------------------------ */

export const MEDIA_SET_RID =
  process.env.ORBIT_MEDIA_SET_RID ||
  "ri.mio.main.media-set.5254ad72-d81f-413c-951e-ad2fba693cb6"

/** Stream a media item's binary content (PDF pages for citations). */
export async function getMediaContent(mediaItemRid: string): Promise<Response> {
  return foundryFetch(
    `/api/v2/mediasets/${MEDIA_SET_RID}/items/${mediaItemRid}/content`,
    { searchParams: { preview: "true" } }
  )
}

export interface MediaReference {
  mimeType: string
  reference: {
    type: string
    mediaSetViewItem?: {
      mediaSetRid: string
      mediaSetViewRid: string
      mediaItemRid: string
    }
  }
}

/**
 * Upload bytes as a temporary media item (persisted when an ontology action
 * references it within 1 hour). Returns the complete MediaReference to pass
 * as the OrbitDocsList `reference` action parameter — matches the SDK's
 * ontology.media.upload_media used by the PoC.
 */
export async function uploadMedia(
  bytes: ArrayBuffer | Uint8Array,
  filename: string
): Promise<MediaReference> {
  const res = await foundryFetch(`/api/v2/mediasets/media/upload`, {
    method: "PUT",
    searchParams: { filename, preview: "true" },
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes as BodyInit,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new FoundryError(
      `Media upload failed (${res.status})`,
      res.status,
      detail.slice(0, 2000)
    )
  }
  return (await res.json()) as MediaReference
}
