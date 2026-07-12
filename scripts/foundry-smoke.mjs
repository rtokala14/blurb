#!/usr/bin/env node
/**
 * Live Foundry smoke test — run this in a session whose environment
 * allowlists jacobs.palantirfoundry.com.
 *
 *   bun run scripts/foundry-smoke.mjs
 *   # or: node scripts/foundry-smoke.mjs
 *
 * It exercises the exact REST surface the app uses, with no Next.js server
 * needed:
 *   1. OAuth2 client-credentials token
 *   2. list the user's OrbitDocsList documents joined with the authoritative
 *      OrbitDocIndexStatus rows (isIndexingComplete wins over the stale
 *      isIndexed property on the doc row)
 *   3. list the user's OrbitDocsUserSessions
 *   4. create a session + one agent turn (streamingContinue), printing the
 *      streamed markdown and any <source> citations
 *   5. fetch the session trace and summarize its toolCallGroups (the
 *      high-level thinking steps the app shows)
 *   6. fetch the first citation's media item (PDF bytes) to prove citation
 *      previews resolve
 *
 * Credentials are read from the environment first, then .env.local:
 *   CLIENT_ID / FOUNDRY_CLIENT_ID
 *   CLIENT_SECRET / FOUNDRY_CLIENT_SECRET
 *   FOUNDRY_TOKEN            (static token; wins over OAuth if set)
 *   FOUNDRY_HOSTNAME         (default https://jacobs.palantirfoundry.com)
 *   ORBIT_USER_EMAIL         (default rohit.tokala@jacobs.com)
 *   FOUNDRY_ONTOLOGY         (default jacobs-ontology)
 *   PRIMARY_AGENT_RID        (default from the PoC)
 *   ORBIT_MEDIA_SET_RID      (default from the PoC)
 *
 * Nothing is written back beyond creating one throwaway chat session +
 * messages (the same objects a normal chat turn creates).
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))

/* ---------- config ------------------------------------------------ */

function loadDotEnvLocal() {
  try {
    const text = readFileSync(resolve(__dirname, "..", ".env.local"), "utf8")
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    /* no .env.local — rely on real env */
  }
}
loadDotEnvLocal()

const CFG = {
  hostname: (process.env.FOUNDRY_HOSTNAME || "https://jacobs.palantirfoundry.com").replace(/\/+$/, ""),
  ontology: process.env.FOUNDRY_ONTOLOGY || "jacobs-ontology",
  clientId: process.env.FOUNDRY_CLIENT_ID || process.env.CLIENT_ID,
  clientSecret: process.env.FOUNDRY_CLIENT_SECRET || process.env.CLIENT_SECRET,
  staticToken: process.env.FOUNDRY_TOKEN,
  userEmail: (process.env.ORBIT_USER_EMAIL || "rohit.tokala@jacobs.com").toLowerCase(),
  primaryAgent: process.env.PRIMARY_AGENT_RID || "ri.aip-agents..agent.b5324c77-83b4-4edb-806a-1d16cc7002a5",
  mediaSet: process.env.ORBIT_MEDIA_SET_RID || "ri.mio.main.media-set.5254ad72-d81f-413c-951e-ad2fba693cb6",
}

const CA = process.env.NODE_EXTRA_CA_CERTS
if (!CA) {
  // In the CCR sandbox the agent proxy needs its CA trusted; nudge if missing.
  console.warn(
    "note: NODE_EXTRA_CA_CERTS is not set. If TLS fails, run with\n" +
      "  NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node scripts/foundry-smoke.mjs\n"
  )
}

let PASS = 0
let FAIL = 0
const ok = (msg) => { PASS++; console.log(`  ✓ ${msg}`) }
const bad = (msg) => { FAIL++; console.log(`  ✗ ${msg}`) }
const section = (n, title) => console.log(`\n[${n}] ${title}`)

/* ---------- helpers ----------------------------------------------- */

async function getToken() {
  if (CFG.staticToken) return CFG.staticToken
  if (!CFG.clientId || !CFG.clientSecret) {
    throw new Error("No credentials: set FOUNDRY_TOKEN or CLIENT_ID/CLIENT_SECRET")
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CFG.clientId,
    client_secret: CFG.clientSecret,
  })
  if (process.env.FOUNDRY_SCOPES) body.set("scope", process.env.FOUNDRY_SCOPES)
  const res = await fetch(`${CFG.hostname}/multipass/api/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!res.ok) {
    throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = await res.json()
  return data.access_token
}

function api(token) {
  return async (path, init = {}) => {
    const url = new URL(`${CFG.hostname}${path}`)
    for (const [k, v] of Object.entries(init.searchParams || {})) url.searchParams.set(k, v)
    const res = await fetch(url, {
      method: init.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      body: init.body,
    })
    return res
  }
}

async function searchObjects(call, objectType, where, select, pageSize = 50, maxItems = 50_000) {
  const out = []
  let pageToken
  do {
    const body = { pageSize }
    if (where) body.where = where
    if (select) body.select = select
    if (pageToken) body.pageToken = pageToken
    const res = await call(
      `/api/v2/ontologies/${CFG.ontology}/objects/${objectType}/search`,
      { method: "POST", body: JSON.stringify(body) }
    )
    if (!res.ok) throw new Error(`${objectType} search ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const page = await res.json()
    out.push(...(page.data || []))
    pageToken = page.nextPageToken
  } while (pageToken && out.length < maxItems)
  return out.slice(0, maxItems)
}

/* ---------- run --------------------------------------------------- */

async function main() {
  console.log("Foundry live smoke test")
  console.log(`  host:    ${CFG.hostname}`)
  console.log(`  user:    ${CFG.userEmail}`)
  console.log(`  agent:   ${CFG.primaryAgent}`)

  /* 1. token */
  section(1, "OAuth token")
  let token
  try {
    token = await getToken()
    ok(`got access token (${token.slice(0, 12)}…, len ${token.length})`)
  } catch (e) {
    bad(`token failed: ${e.message}`)
    return finish()
  }
  const call = api(token)

  /* 2. documents — index status resolved via OrbitDocIndexStatus (the
     authoritative source, keyed by docKey), NOT the isIndexed property on
     OrbitDocsList, which is only a stale fallback. Matches the PoC's
     _build_index_status_map + _build_orbit_doc. */
  section(2, "Documents (OrbitDocsList ⋈ OrbitDocIndexStatus)")
  let docs = []
  try {
    const [docRows, statusRows] = await Promise.all([
      searchObjects(
        call,
        "OrbitDocsList",
        { type: "and", value: [
          { type: "eq", field: "addedBy", value: CFG.userEmail },
          { type: "eq", field: "isActive", value: true },
        ] },
        ["primaryKey_", "documentName", "isIndexed", "noPages", "reference"],
        1000
      ),
      searchObjects(
        call,
        "OrbitDocIndexStatus",
        undefined,
        ["docKey", "isIndexingComplete", "noPages"],
        2000
      ),
    ])
    const statusByDocKey = new Map(
      statusRows.filter((s) => s.docKey).map((s) => [String(s.docKey), s])
    )
    docs = docRows.map((d) => {
      const status = statusByDocKey.get(String(d.primaryKey_ ?? d.__primaryKey))
      return {
        ...d,
        isIndexed: status?.isIndexingComplete ?? Boolean(d.isIndexed),
        noPages: d.noPages ?? status?.noPages ?? null,
      }
    })
    ok(`fetched ${docs.length} document(s), ${statusRows.length} index-status row(s)`)
    const indexed = docs.filter((d) => d.isIndexed)
    ok(`${indexed.length} indexed via OrbitDocIndexStatus join`)
    indexed.slice(0, 5).forEach((d) =>
      console.log(`      - ${d.documentName} (indexed=${d.isIndexed}, pages=${d.noPages ?? "?"})`)
    )
  } catch (e) {
    bad(`documents failed: ${e.message}`)
  }
  const indexedDocs = docs.filter((d) => d.isIndexed)

  /* 3. sessions */
  section(3, "Sessions (OrbitDocsUserSessions, user = email)")
  try {
    const sessions = await searchObjects(
      call,
      "OrbitDocsUserSessions",
      { type: "eq", field: "user", value: CFG.userEmail },
      ["primaryKey_", "title", "updatedAt", "isDeleted"],
      25
    )
    const active = sessions.filter((s) => !s.isDeleted)
    ok(`fetched ${active.length} active session(s)`)
    active.slice(0, 5).forEach((s) => console.log(`      - ${s.title || "(untitled)"}`))
  } catch (e) {
    bad(`sessions failed: ${e.message}`)
  }

  /* 4. one agent turn */
  section(4, "Agent turn (create AIP session + streamingContinue)")
  if (indexedDocs.length === 0) {
    console.log("      skipped: no indexed documents to scope the agent to")
  } else {
    try {
      const scopeDocIds = indexedDocs.slice(0, 3).map((d) => String(d.primaryKey_ ?? d.__primaryKey))
      const created = await call(
        `/api/v2/aipAgents/agents/${CFG.primaryAgent}/sessions`,
        { method: "POST", searchParams: { preview: "true" }, body: JSON.stringify({}) }
      )
      if (!created.ok) throw new Error(`create session ${created.status}: ${(await created.text()).slice(0, 200)}`)
      const aip = await created.json()
      ok(`created AIP session ${aip.rid}`)

      const parameterInputs = {
        userDocs: {
          type: "objectSet",
          ontology: CFG.ontology,
          objectSet: {
            type: "union",
            objectSets: scopeDocIds.map((id) => ({
              type: "filter",
              objectSet: { type: "base", objectType: "OrbitDocsList" },
              where: { type: "eq", field: "primaryKey_", value: id },
            })),
          },
        },
      }
      const prompt =
        "In one or two sentences, what is the single most important thing in these documents? Cite your sources."
      const traceId = crypto.randomUUID()
      globalThis.__traceRef = { agentRid: CFG.primaryAgent, sessionRid: aip.rid, traceId }
      const streamRes = await call(
        `/api/v2/aipAgents/agents/${CFG.primaryAgent}/sessions/${aip.rid}/streamingContinue`,
        {
          method: "POST",
          searchParams: { preview: "true" },
          headers: { Accept: "application/octet-stream" },
          body: JSON.stringify({
            userInput: { text: prompt },
            messageId: crypto.randomUUID(),
            sessionTraceId: traceId,
            parameterInputs,
          }),
        }
      )
      if (!streamRes.ok || !streamRes.body) {
        throw new Error(`streamingContinue ${streamRes.status}: ${(await streamRes.text()).slice(0, 300)}`)
      }
      const reader = streamRes.body.getReader()
      const decoder = new TextDecoder()
      let full = ""
      process.stdout.write("      reply: ")
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        full += chunk
        process.stdout.write(chunk.replace(/\n/g, "\n             "))
      }
      full += decoder.decode()
      console.log()
      if (full.trim()) ok(`streamed ${full.length} chars`)
      else bad("stream produced no text")

      const sources = [...full.matchAll(/<source\b([^>]*)>([\s\S]*?)<\/source>/gi)]
      if (sources.length > 0) {
        ok(`found ${sources.length} inline citation(s)`)
        globalThis.__firstCitationId = (sources[0][1].match(/id="([^"]+)"/) || [])[1]
      } else {
        console.log("      (no <source> citations in this reply — that's fine)")
      }
    } catch (e) {
      bad(`agent turn failed: ${e.message}`)
    }
  }

  /* 5. thinking trace (high-level summary of tool calls) */
  section(5, "Session trace (toolCallGroups → high-level steps)")
  const traceRef = globalThis.__traceRef
  if (!traceRef) {
    console.log("      skipped: no agent turn ran")
  } else {
    try {
      const res = await call(
        `/api/v2/aipAgents/agents/${traceRef.agentRid}/sessions/${traceRef.sessionRid}/sessionTraces/${traceRef.traceId}`,
        { searchParams: { preview: "true" } }
      )
      if (!res.ok) throw new Error(`trace ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const trace = await res.json()
      ok(`trace status ${trace.status}`)
      const groups = trace.toolCallGroups ?? []
      const labels = groups.flatMap((g) =>
        (g.toolCalls ?? []).map((c) => c.toolMetadata?.name || "Working")
      )
      if (labels.length > 0) {
        ok(`${labels.length} tool call(s): ${[...new Set(labels)].join(", ")}`)
      } else {
        console.log("      (no tool calls recorded in this trace — that's fine)")
      }
    } catch (e) {
      bad(`trace fetch failed: ${e.message}`)
    }
  }

  /* 6. citation media fetch */
  section(6, "Citation media fetch (media set item content)")
  const citationId = globalThis.__firstCitationId
  if (!citationId) {
    console.log("      skipped: no citation media RID from step 4")
  } else {
    try {
      const res = await call(
        `/api/v2/mediasets/${CFG.mediaSet}/items/${citationId}/content`,
        { searchParams: { preview: "true" } }
      )
      if (!res.ok) throw new Error(`media ${res.status}`)
      const buf = new Uint8Array(await res.arrayBuffer())
      const isPdf = buf[0] === 0x25 && buf[1] === 0x50 // %P
      ok(`fetched ${buf.length} bytes${isPdf ? " (PDF)" : ""} for ${citationId}`)
    } catch (e) {
      bad(`media fetch failed: ${e.message}`)
    }
  }

  finish()
}

function finish() {
  console.log(`\n${"-".repeat(48)}`)
  console.log(`Result: ${PASS} passed, ${FAIL} failed`)
  process.exit(FAIL > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("\nfatal:", e.message)
  process.exit(1)
})
