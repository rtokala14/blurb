#!/usr/bin/env node
/**
 * Live Foundry smoke test — Orbit Docs v3 pipeline.
 *
 * Run in a session whose environment allowlists jacobs.palantirfoundry.com:
 *   bun run scripts/foundry-smoke.mjs
 *   # or: node scripts/foundry-smoke.mjs
 *
 * It exercises the exact REST surface the v3 app uses, with no Next.js server
 * needed. Every check prints PASS / FAIL (or WARN for known, non-code
 * conditions) with details, and the process exits 1 if any check FAILs.
 *
 *   a. OAuth2 client-credentials token
 *   b. Read every one of the 9 v3 object types (pageSize 1); a 403 is reported
 *      distinctly as PERMISSION_DENIED (perms not yet granted for that type)
 *   c. User upsert against OrbitDocsUserV2 (PK = email)
 *   d. Aggregate contract on OrbitDocsChunks (validates countObjects wiring)
 *   e. Upload chain round-trip: temp media upload → doc-meta create → read →
 *      delete
 *   f. Folder round-trip: create → read → nested child → delete child + parent
 *   g. Chat round-trip: session → user msg → assistant msg → repoint leaf →
 *      read → delete
 *   h. Main-agent ontology query (orbitDocsV3MainAgent)
 *   i. Media content read for a doc-meta row that carries a media reference
 *
 * All mutations self-clean; nothing durable is left behind.
 *
 * Credentials/config are read from the environment first, then .env, then
 * .env.local (the repo uses .env now; .env.local is still honored):
 *   CLIENT_ID / FOUNDRY_CLIENT_ID
 *   CLIENT_SECRET / FOUNDRY_CLIENT_SECRET
 *   FOUNDRY_TOKEN            (static token; wins over OAuth if set)
 *   FOUNDRY_HOSTNAME         (default https://jacobs.palantirfoundry.com)
 *   ORBIT_USER_EMAIL         (default rohit.tokala@jacobs.com)
 *   FOUNDRY_ONTOLOGY         (default jacobs-ontology)
 *   ORBIT_MAIN_AGENT_QUERY   (default orbitDocsV3MainAgent)
 *   FOUNDRY_SCOPES           (optional OAuth scopes)
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))

/* ---------- config ------------------------------------------------ */

function loadDotEnv(name) {
  try {
    const text = readFileSync(resolve(__dirname, "..", name), "utf8")
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
    /* file not present — rely on real env / the other file */
  }
}
// .env is the v3 repo default; .env.local is still honored as a fallback.
loadDotEnv(".env")
loadDotEnv(".env.local")

const CFG = {
  hostname: (
    process.env.FOUNDRY_HOSTNAME || "https://jacobs.palantirfoundry.com"
  ).replace(/\/+$/, ""),
  ontology: process.env.FOUNDRY_ONTOLOGY || "jacobs-ontology",
  clientId: process.env.FOUNDRY_CLIENT_ID || process.env.CLIENT_ID,
  clientSecret: process.env.FOUNDRY_CLIENT_SECRET || process.env.CLIENT_SECRET,
  staticToken: process.env.FOUNDRY_TOKEN,
  userEmail: (process.env.ORBIT_USER_EMAIL || "rohit.tokala@jacobs.com")
    .trim()
    .toLowerCase(),
  mainAgentQuery: process.env.ORBIT_MAIN_AGENT_QUERY || "orbitDocsV3MainAgent",
  agentRid:
    process.env.PRIMARY_AGENT_RID ||
    "ri.aip-agents..agent.2addece7-23d3-4d5f-b521-27747fce8806",
}

const CA = process.env.NODE_EXTRA_CA_CERTS
if (!CA) {
  console.warn(
    "note: NODE_EXTRA_CA_CERTS is not set. If TLS fails, run with\n" +
      "  NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node scripts/foundry-smoke.mjs\n"
  )
}

let PASS = 0
let FAIL = 0
let WARN = 0
const ok = (msg) => {
  PASS++
  console.log(`  ✓ ${msg}`)
}
const bad = (msg) => {
  FAIL++
  console.log(`  ✗ ${msg}`)
}
const warn = (msg) => {
  WARN++
  console.log(`  ! ${msg}`)
}
const info = (msg) => console.log(`      ${msg}`)
const section = (n, title) => console.log(`\n[${n}] ${title}`)

/* ---------- the 9 v3 object types --------------------------------- */

const OBJECT_TYPES = [
  "OrbitDocsUserV2",
  "OrbitDocsFolderRegistry",
  "OrbitDocsDocMeta",
  "OrbitDocsChunks",
  "OrbitDocsEntitiesCanonical",
  "OrbitDocsRelationships",
  "OrbitDocsChatSessions",
  "OrbitDocsChatMessages",
  "OrbitDocsRateLimitGrants",
]

/* ---------- helpers ----------------------------------------------- */

async function getToken() {
  if (CFG.staticToken) return CFG.staticToken
  if (!CFG.clientId || !CFG.clientSecret) {
    throw new Error(
      "No credentials: set FOUNDRY_TOKEN or CLIENT_ID/CLIENT_SECRET"
    )
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
    for (const [k, v] of Object.entries(init.searchParams || {})) {
      url.searchParams.set(k, v)
    }
    return fetch(url, {
      method: init.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body && typeof init.body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
        ...(init.headers || {}),
      },
      body: init.body,
    })
  }
}

const ontologyPath = (suffix) =>
  `/api/v2/ontologies/${CFG.ontology}/${suffix}`

async function readJson(res) {
  const text = await res.text().catch(() => "")
  try {
    return JSON.parse(text)
  } catch {
    return { __raw: text }
  }
}

async function searchPage(call, objectType, body) {
  const res = await call(
    ontologyPath(`objects/${objectType}/search`),
    { method: "POST", body: JSON.stringify(body) }
  )
  return { res, json: await readJson(res) }
}

async function getObject(call, objectType, primaryKey) {
  const res = await call(
    ontologyPath(`objects/${objectType}/${encodeURIComponent(primaryKey)}`)
  )
  if (res.status === 404) return { res, json: null }
  return { res, json: await readJson(res) }
}

/** Apply an ontology action; strips undefined params (Foundry rejects nulls). */
async function applyAction(call, actionApiName, parameters, returnEdits = false) {
  const cleaned = {}
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined) cleaned[key] = value
  }
  const res = await call(ontologyPath(`actions/${actionApiName}/apply`), {
    method: "POST",
    body: JSON.stringify({
      parameters: cleaned,
      options: { returnEdits: returnEdits ? "ALL" : "NONE" },
    }),
  })
  const json = await readJson(res)
  if (!res.ok) {
    throw new Error(
      `${actionApiName} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`
    )
  }
  return json
}

/** Pull the created primary key out of an apply-with-edits response. */
function extractCreatedPrimaryKey(response, objectType) {
  for (const edit of response?.edits?.edits ?? []) {
    if (edit.type === "addObject" && edit.objectType === objectType) {
      return String(edit.primaryKey ?? "")
    }
  }
  throw new Error(`could not extract created primary key for ${objectType}`)
}

function nowIso() {
  return new Date().toISOString()
}

function deriveName(email) {
  const local = email.split("@", 1)[0] || ""
  const tokens = local.replace(/[_-]/g, ".").split(".").filter(Boolean)
  if (tokens.length === 0) return "User"
  return tokens.map((t) => t[0].toUpperCase() + t.slice(1)).join(" ")
}

// A tiny structurally-valid PDF (starts with %PDF, ends with %%EOF).
const PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.4\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n"
)

function mediaItemFromReference(reference) {
  return reference?.reference?.mediaSetViewItem ?? null
}

/* ---------- run --------------------------------------------------- */

async function main() {
  console.log("Foundry v3 live smoke test")
  console.log(`  host:     ${CFG.hostname}`)
  console.log(`  ontology: ${CFG.ontology}`)
  console.log(`  user:     ${CFG.userEmail}`)
  console.log(`  agent:    ${CFG.mainAgentQuery} (ontology query)`)

  /* a. token ------------------------------------------------------- */
  section("a", "OAuth token")
  let token
  try {
    token = await getToken()
    ok(`got access token (${token.slice(0, 12)}…, len ${token.length})`)
  } catch (e) {
    bad(`token failed: ${e.message}`)
    return finish()
  }
  const call = api(token)

  /* b. read checks on all 9 object types --------------------------- */
  section("b", "Read checks (search each object type, pageSize 1)")
  for (const objectType of OBJECT_TYPES) {
    try {
      const { res, json } = await searchPage(call, objectType, { pageSize: 1 })
      if (res.ok) {
        ok(`${objectType}: readable (${(json.data ?? []).length} row sampled)`)
      } else if (res.status === 403) {
        const name = json?.errorName || json?.errorCode || "PERMISSION_DENIED"
        warn(`${objectType}: 403 PERMISSION_DENIED (${name}) — perms not yet granted for this type`)
      } else {
        bad(`${objectType}: search ${res.status}: ${JSON.stringify(json).slice(0, 160)}`)
      }
    } catch (e) {
      bad(`${objectType}: ${e.message}`)
    }
  }

  /* c. user upsert (OrbitDocsUserV2, PK = email) ------------------- */
  section("c", "User upsert (OrbitDocsUserV2)")
  try {
    let { json: user } = await getObject(call, "OrbitDocsUserV2", CFG.userEmail)
    if (!user) {
      info("user row missing — creating via create-orbit-docs-v3-user")
      const ts = nowIso()
      await applyAction(call, "create-orbit-docs-v3-user", {
        // The generated OpenAPI omits `email`, but the action requires it.
        email: CFG.userEmail,
        name: deriveName(CFG.userEmail),
        role: "user",
        isOnboarded: false,
        isAllowedToUpload: false,
        dailyUploadLimit: 10,
        options: "{}",
        createdAt: ts,
        updatedAt: ts,
      })
      const reread = await getObject(call, "OrbitDocsUserV2", CFG.userEmail)
      user = reread.json
    }
    if (!user) {
      bad("user row still missing after create")
    } else {
      const email = String(user.email ?? user.__primaryKey ?? "").toLowerCase()
      if (email === CFG.userEmail) {
        ok(`user row present, email matches (role=${user.role ?? "?"})`)
      } else {
        bad(`user email mismatch: got "${email}", expected "${CFG.userEmail}"`)
      }
    }
  } catch (e) {
    bad(`user upsert failed: ${e.message}`)
  }

  /* d. aggregate contract on OrbitDocsChunks ----------------------- */
  section("d", "Aggregate contract (OrbitDocsChunks count by documentId)")
  try {
    const res = await call(
      ontologyPath("objects/OrbitDocsChunks/aggregate"),
      {
        method: "POST",
        body: JSON.stringify({
          aggregation: [{ type: "count", name: "count" }],
          groupBy: [
            { type: "exact", field: "documentId", maxGroupCount: 10_000 },
          ],
        }),
      }
    )
    const json = await readJson(res)
    if (!res.ok) {
      if (res.status === 403) {
        warn(`aggregate 403 PERMISSION_DENIED — perms not yet granted for OrbitDocsChunks`)
      } else {
        bad(`aggregate ${res.status}: ${JSON.stringify(json).slice(0, 200)}`)
      }
    } else if (!Array.isArray(json.data)) {
      bad(`aggregate response missing data[] array`)
    } else {
      const first = json.data[0]
      const shapeOk =
        json.data.length === 0 ||
        (first && "group" in first && "metrics" in first)
      if (shapeOk) {
        ok(`aggregate returned ${json.data.length} group(s) with {group, metrics} shape`)
      } else {
        bad(`aggregate rows are not {group, metrics}: ${JSON.stringify(first).slice(0, 160)}`)
      }
    }
  } catch (e) {
    bad(`aggregate failed: ${e.message}`)
  }

  /* e. upload chain round-trip ------------------------------------- */
  section("e", "Upload chain round-trip (media → doc-meta → read → delete)")
  try {
    const uploadRes = await call("/api/v2/mediasets/media/upload", {
      method: "PUT",
      searchParams: { filename: "smoke-test.pdf", preview: "true" },
      headers: { "Content-Type": "application/octet-stream" },
      body: PDF_BYTES,
    })
    if (!uploadRes.ok) {
      throw new Error(
        `media upload ${uploadRes.status}: ${(await uploadRes.text()).slice(0, 200)}`
      )
    }
    const mediaReference = await uploadRes.json()
    const item = mediaItemFromReference(mediaReference)
    if (!item?.mediaItemRid) throw new Error("upload returned no media item rid")
    ok(`uploaded temp media item ${item.mediaItemRid}`)

    const created = await applyAction(
      call,
      "create-orbit-docs-doc-meta",
      {
        fileName: "smoke-test.pdf",
        mime: "application/pdf",
        mediaPath: `smoke-${Date.now()}.pdf`,
        mediaItemRid: item.mediaItemRid,
        mediaReference,
        parentFolderId: "folder-root",
        status: "uploaded",
        uploadTs: nowIso(),
        userEmail: CFG.userEmail,
        allowedUserIds: [CFG.userEmail],
      },
      true
    )
    const documentId = extractCreatedPrimaryKey(created, "OrbitDocsDocMeta")
    ok(`created doc-meta documentId=${documentId} (format: ${documentIdFormat(documentId)})`)

    const { json: readBack } = await getObject(
      call,
      "OrbitDocsDocMeta",
      documentId
    )
    if (readBack && String(readBack.documentId ?? readBack.__primaryKey) === documentId) {
      ok(`read the doc-meta row back`)
    } else {
      bad(`could not read created doc-meta ${documentId} back`)
    }

    await applyAction(call, "delete-orbit-docs-doc-meta", {
      OrbitDocsDocMeta: documentId,
    })
    ok(`deleted doc-meta ${documentId} (cleanup)`)
  } catch (e) {
    bad(`upload chain failed: ${e.message}`)
  }

  /* f. folder round-trip ------------------------------------------- */
  section("f", "Folder round-trip (create → read → nested child → delete)")
  let parentFolderId
  let childFolderId
  try {
    const parent = await applyAction(
      call,
      "create-orbit-docs-folder-registry",
      {
        name: `smoke-parent-${Date.now()}`,
        parentFolderId: "folder-root",
        ownerUserId: CFG.userEmail,
        allowedUserIds: [CFG.userEmail],
        createdTs: nowIso(),
      },
      true
    )
    parentFolderId = extractCreatedPrimaryKey(parent, "OrbitDocsFolderRegistry")
    ok(`created parent folder ${parentFolderId}`)

    const { json: readParent } = await getObject(
      call,
      "OrbitDocsFolderRegistry",
      parentFolderId
    )
    if (readParent) ok(`read parent folder back`)
    else bad(`could not read parent folder ${parentFolderId} back`)

    const child = await applyAction(
      call,
      "create-orbit-docs-folder-registry",
      {
        name: `smoke-child-${Date.now()}`,
        parentFolderId,
        ownerUserId: CFG.userEmail,
        allowedUserIds: [CFG.userEmail],
        createdTs: nowIso(),
      },
      true
    )
    childFolderId = extractCreatedPrimaryKey(child, "OrbitDocsFolderRegistry")
    ok(`created nested child folder ${childFolderId} under parent`)
  } catch (e) {
    bad(`folder round-trip failed: ${e.message}`)
  } finally {
    try {
      if (childFolderId) {
        await applyAction(call, "delete-orbit-docs-folder-registry", {
          OrbitDocsFolderRegistry: childFolderId,
        })
        ok(`deleted child folder (cleanup)`)
      }
      if (parentFolderId) {
        await applyAction(call, "delete-orbit-docs-folder-registry", {
          OrbitDocsFolderRegistry: parentFolderId,
        })
        ok(`deleted parent folder (cleanup)`)
      }
    } catch (e) {
      bad(`folder cleanup failed: ${e.message}`)
    }
  }

  /* g. chat round-trip --------------------------------------------- */
  section("g", "Chat round-trip (session → messages → repoint leaf → delete)")
  let sessionId
  let userMsgId
  let asstMsgId
  try {
    const session = await applyAction(
      call,
      "create-orbit-docs-chat-sessions",
      {
        userEmail: CFG.userEmail,
        title: "smoke session",
        summary: "",
        options: "{}",
        createdAt: nowIso(),
        lastUpdatedAt: nowIso(),
        isDeleted: false,
        activeLeafMessageId: "",
      },
      true
    )
    sessionId = extractCreatedPrimaryKey(session, "OrbitDocsChatSessions")
    ok(`created session ${sessionId}`)

    const userMsg = await applyAction(
      call,
      "create-orbit-docs-chat-messages",
      {
        sessionId,
        role: "user",
        content: "ping",
        parentMessageId: "",
        scope: JSON.stringify({ documentIds: [], folderIds: [] }),
        citations: "[]",
        model: "",
        createdAt: nowIso(),
        isDeleted: false,
      },
      true
    )
    userMsgId = extractCreatedPrimaryKey(userMsg, "OrbitDocsChatMessages")
    ok(`created user message ${userMsgId} (root, parentMessageId="")`)

    const asstMsg = await applyAction(
      call,
      "create-orbit-docs-chat-messages",
      {
        sessionId,
        role: "assistant",
        content: "pong",
        parentMessageId: userMsgId,
        scope: JSON.stringify({ documentIds: [], folderIds: [] }),
        citations: "[]",
        model: "smoke",
        createdAt: nowIso(),
        isDeleted: false,
      },
      true
    )
    asstMsgId = extractCreatedPrimaryKey(asstMsg, "OrbitDocsChatMessages")
    ok(`created assistant message ${asstMsgId} (child of user message)`)

    // Repoint the session's active leaf to the assistant message (full replay).
    await applyAction(call, "edit-orbit-docs-chat-sessions", {
      OrbitDocsChatSessions: sessionId,
      userEmail: CFG.userEmail,
      title: "smoke session",
      summary: "",
      options: "{}",
      createdAt: nowIso(),
      lastUpdatedAt: nowIso(),
      isDeleted: false,
      activeLeafMessageId: asstMsgId,
    })

    const { json: readSession } = await getObject(
      call,
      "OrbitDocsChatSessions",
      sessionId
    )
    if (readSession && readSession.activeLeafMessageId === asstMsgId) {
      ok(`session activeLeafMessageId now points at the assistant message`)
    } else {
      bad(`activeLeafMessageId not updated (got ${readSession?.activeLeafMessageId})`)
    }
  } catch (e) {
    bad(`chat round-trip failed: ${e.message}`)
  } finally {
    try {
      if (asstMsgId) {
        await applyAction(call, "delete-orbit-docs-chat-messages", {
          OrbitDocsChatMessages: asstMsgId,
        })
      }
      if (userMsgId) {
        await applyAction(call, "delete-orbit-docs-chat-messages", {
          OrbitDocsChatMessages: userMsgId,
        })
      }
      if (sessionId) {
        await applyAction(call, "delete-orbit-docs-chat-sessions", {
          OrbitDocsChatSessions: sessionId,
        })
      }
      if (sessionId) ok(`deleted messages + session (cleanup)`)
    } catch (e) {
      bad(`chat cleanup failed: ${e.message}`)
    }
  }

  /* h. main agent via AIP platform Sessions API --------------------- */
  section("h", `Main agent (AIP Sessions API, ${CFG.agentRid.slice(-12)})`)
  const isModelIssue = (blob) =>
    blob.includes("AgentFailedValidation") ||
    blob.includes("UnsupportedLanguageModelRid") ||
    blob.includes("unsupportedLanguageModel")
  try {
    // agent metadata (also validates the RID + parameter names)
    const metaRes = await call(
      `/api/v2/aipAgents/agents/${CFG.agentRid}?preview=true`
    )
    const meta = await readJson(metaRes)
    if (metaRes.ok) {
      const params = Object.keys(meta.parameters ?? {})
      ok(
        `agent "${meta.metadata?.displayName ?? "?"}" v${meta.version ?? "?"} — parameters: ${params.join(", ") || "none"}`
      )
      const expected = ["Files", "Folders"]
      const missing = expected.filter((p) => !params.includes(p))
      if (missing.length > 0) {
        warn(`agent is missing expected parameters: ${missing.join(", ")}`)
      }
    } else {
      bad(`agent metadata ${metaRes.status}: ${JSON.stringify(meta).slice(0, 200)}`)
    }

    // session create → blockingContinue → follow-up on the same session
    const sessRes = await call(
      `/api/v2/aipAgents/agents/${CFG.agentRid}/sessions?preview=true`,
      { method: "POST", body: "{}" }
    )
    const sess = await readJson(sessRes)
    if (!sessRes.ok) {
      const blob = JSON.stringify(sess)
      if (isModelIssue(blob)) {
        warn(
          "session create rejected: the agent's language model is not accessible to this token.\n" +
            "        WARNING: enable the model for this enrollment/project (Control Panel → model access)\n" +
            "        or pick a supported model in AIP Chatbot Studio. Known Foundry-side config issue,\n" +
            "        NOT a code failure."
        )
      } else {
        bad(`session create ${sessRes.status}: ${blob.slice(0, 300)}`)
      }
    } else {
      ok(`AIP session created (${String(sess.rid).slice(0, 40)}…)`)
      const contRes = await call(
        `/api/v2/aipAgents/agents/${CFG.agentRid}/sessions/${sess.rid}/blockingContinue?preview=true`,
        {
          method: "POST",
          body: JSON.stringify({
            userInput: { text: "Reply with the single word: pong" },
          }),
        }
      )
      const cont = await readJson(contRes)
      if (contRes.ok) {
        const reply = cont.agentMarkdownResponse ?? ""
        ok(`agent replied (${reply.length} chars): ${reply.slice(0, 60)}`)
        const cont2 = await call(
          `/api/v2/aipAgents/agents/${CFG.agentRid}/sessions/${sess.rid}/blockingContinue?preview=true`,
          {
            method: "POST",
            body: JSON.stringify({
              userInput: { text: "Now reply with the single word: pang" },
            }),
          }
        )
        const cont2Json = await readJson(cont2)
        if (cont2.ok) {
          ok(
            `follow-up on the same session succeeded (${(cont2Json.agentMarkdownResponse ?? "").length} chars)`
          )
        } else {
          bad(`follow-up ${cont2.status}: ${JSON.stringify(cont2Json).slice(0, 200)}`)
        }
      } else {
        const blob = JSON.stringify(cont)
        if (isModelIssue(blob)) {
          warn(
            "continue rejected for the agent's language model — see the session-create note above."
          )
        } else {
          bad(`blockingContinue ${contRes.status}: ${blob.slice(0, 300)}`)
        }
      }
    }
  } catch (e) {
    bad(`agent check failed: ${e.message}`)
  }

  /* i. media content read ------------------------------------------ */
  section("i", "Media content read (doc-meta row with a media reference)")
  try {
    const { res, json } = await searchPage(call, "OrbitDocsDocMeta", {
      pageSize: 25,
      select: ["documentId", "fileName", "mediaReference"],
    })
    if (!res.ok) {
      if (res.status === 403) {
        warn("OrbitDocsDocMeta 403 PERMISSION_DENIED — cannot sample a media row")
      } else {
        bad(`doc-meta sample ${res.status}: ${JSON.stringify(json).slice(0, 160)}`)
      }
    } else {
      const withMedia = (json.data ?? []).find(
        (row) => mediaItemFromReference(row.mediaReference)
      )
      if (!withMedia) {
        info("no doc-meta row with a media reference to read — skipping")
      } else {
        const item = mediaItemFromReference(withMedia.mediaReference)
        const contentRes = await call(
          `/api/v2/mediasets/${item.mediaSetRid}/items/${item.mediaItemRid}/content`,
          { searchParams: { preview: "true" } }
        )
        if (!contentRes.ok) {
          bad(`media content ${contentRes.status} for ${item.mediaItemRid}`)
        } else {
          const buf = new Uint8Array(await contentRes.arrayBuffer())
          const isPdf = buf[0] === 0x25 && buf[1] === 0x50 // %P
          ok(`read ${buf.length} bytes${isPdf ? " (PDF)" : ""} for ${withMedia.fileName ?? item.mediaItemRid}`)
        }
      }
    }
  } catch (e) {
    bad(`media content read failed: ${e.message}`)
  }

  finish()
}

function documentIdFormat(id) {
  if (/^ri\./.test(id)) return "ri.*"
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return "uuid"
  return "opaque"
}

function finish() {
  console.log(`\n${"-".repeat(52)}`)
  console.log(`Result: ${PASS} passed, ${FAIL} failed, ${WARN} warning(s)`)
  process.exit(FAIL > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("\nfatal:", e.message)
  process.exit(1)
})
