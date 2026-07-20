import "server-only"

import { getFoundryConfig } from "./config"
import { getFoundryToken } from "./token"

/**
 * Minimal Foundry REST client built directly on the platform openapi spec —
 * no SDK. Covers ontology object search/get/aggregate, action apply, query
 * execute, and media set upload/content for the v3 pipeline.
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
  | { type: "lt"; field: string; value: unknown }
  | { type: "in"; field: string; value: unknown[] }
  | { type: "contains"; field: string; value: unknown }
  | { type: "isNull"; field: string; value: boolean }
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

/** Foundry caps `in` filter cardinality; chunk under it. */
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
/* Ontology: aggregation                                                */
/* ------------------------------------------------------------------ */

interface AggregateResponse {
  data?: {
    group?: Record<string, unknown>
    metrics?: { name?: string; value?: unknown }[]
  }[]
}

/**
 * Count objects matching `where`, optionally grouped by an exact field.
 * Returns a map of group value → count ("" key when ungrouped).
 */
export async function countObjects(
  objectType: string,
  {
    where,
    groupByField,
    maxGroupCount = 10_000,
  }: { where?: WhereClause; groupByField?: string; maxGroupCount?: number } = {}
): Promise<Map<string, number>> {
  const cfg = getFoundryConfig()
  const body: Record<string, unknown> = {
    aggregation: [{ type: "count", name: "count" }],
  }
  if (where) body.where = where
  if (groupByField) {
    body.groupBy = [{ type: "exact", field: groupByField, maxGroupCount }]
  }
  const res = await foundryJson<AggregateResponse>(
    `/api/v2/ontologies/${cfg.ontology}/objects/${objectType}/aggregate`,
    { method: "POST", body: JSON.stringify(body) }
  )
  const out = new Map<string, number>()
  for (const row of res.data ?? []) {
    const key = groupByField ? String(row.group?.[groupByField] ?? "") : ""
    const metric = row.metrics?.find((m) => m.name === "count")
    out.set(key, Number(metric?.value ?? 0))
  }
  return out
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
 * "create-orbit-docs-doc-meta").
 */
export async function applyAction<T = ActionEdits>(
  actionApiName: string,
  parameters: Record<string, unknown>,
  { returnEdits = false }: { returnEdits?: boolean } = {}
): Promise<T> {
  const cfg = getFoundryConfig()
  // Foundry rejects explicit nulls for omitted params — strip undefined.
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
/* AIP Agents (platform Sessions API, all endpoints need ?preview=true) */
/* ------------------------------------------------------------------ */

export interface AipSession {
  rid: string
  agentRid?: string
  agentVersion?: string
}

export async function createAipSession(agentRid: string): Promise<AipSession> {
  return foundryJson<AipSession>(`/api/v2/aipAgents/agents/${agentRid}/sessions`, {
    method: "POST",
    searchParams: { preview: "true" },
    body: JSON.stringify({}),
  })
}

export interface StreamingContinueInput {
  agentRid: string
  sessionRid: string
  userInput: string
  parameterInputs?: Record<string, unknown>
  messageId?: string
  sessionTraceId?: string
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
  }
  if (input.messageId) payload.messageId = input.messageId
  if (input.sessionTraceId) payload.sessionTraceId = input.sessionTraceId
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
  metadata?: { displayName?: string; description?: string }
  parameters?: Record<string, unknown>
}> {
  return foundryJson(`/api/v2/aipAgents/agents/${agentRid}`, {
    searchParams: { preview: "true" },
  })
}

/* ------------------------------------------------------------------ */
/* Media sets                                                           */
/* ------------------------------------------------------------------ */

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
 * Stream a media item's binary content. The v3 model carries the full
 * MediaReference on every OrbitDocsDocMeta row, so reads are addressed by
 * the media set + item the reference points at (no hardcoded set RID).
 */
export async function getMediaContentByReference(
  reference: MediaReference
): Promise<Response> {
  const item = reference.reference?.mediaSetViewItem
  if (!item?.mediaSetRid || !item.mediaItemRid) {
    throw new FoundryError("Media reference is missing set/item RIDs", 422)
  }
  return foundryFetch(
    `/api/v2/mediasets/${item.mediaSetRid}/items/${item.mediaItemRid}/content`,
    { searchParams: { preview: "true" } }
  )
}

/**
 * Upload bytes as a temporary media item (persisted into the property's
 * backing media set when an ontology action references it within 1 hour).
 * Returns the complete MediaReference to pass as the create-doc-meta
 * `mediaReference` action parameter.
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

/** Extract the media item RID from a MediaReference (or null). */
export function extractMediaItemRid(
  reference: MediaReference | null | undefined
): string | null {
  const rid = reference?.reference?.mediaSetViewItem?.mediaItemRid
  return rid && rid.startsWith("ri.") ? rid : null
}
