#!/usr/bin/env node
/**
 * Foundry v3 permission matrix.
 *
 * Non-destructive: object reads use search(pageSize 1); every action is probed
 * with mode=VALIDATE_ONLY, which evaluates the action's submission criteria
 * (group membership) WITHOUT writing anything. The agent check creates a
 * throwaway AIP session; the media check uploads a temp item that Foundry
 * auto-deletes within an hour.
 *
 * Run repeatedly while granting permissions in Foundry until every row is ✓.
 *   node scripts/foundry-actions-check.mjs
 */

import fs from "node:fs"
import path from "node:path"

/* ---------- env ---------------------------------------------------- */

function loadDotEnv(file) {
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), file), "utf8")
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
      if (!m) continue
      const key = m[1]
      let val = m[2].replace(/^["']|["']$/g, "")
      // .env is this project's source of truth — let it win (the shell exports
      // its own HOSTNAME, which would otherwise shadow the Foundry host).
      process.env[key] = val
    }
  } catch {
    /* not present */
  }
}
loadDotEnv(".env")
loadDotEnv(".env.local")

const CFG = {
  host: (process.env.FOUNDRY_HOSTNAME || process.env.HOSTNAME || "https://jacobs.palantirfoundry.com").replace(/\/+$/, ""),
  ontology: process.env.FOUNDRY_ONTOLOGY || "jacobs-ontology",
  clientId: process.env.FOUNDRY_CLIENT_ID || process.env.CLIENT_ID,
  clientSecret: process.env.FOUNDRY_CLIENT_SECRET || process.env.CLIENT_SECRET,
  token: process.env.FOUNDRY_TOKEN,
  email: (process.env.ORBIT_USER_EMAIL || "rohit.tokala@jacobs.com").trim().toLowerCase(),
  agentRid: process.env.PRIMARY_AGENT_RID || "ri.aip-agents..agent.2addece7-23d3-4d5f-b521-27747fce8806",
}

/* ---------- tiny http ---------------------------------------------- */

async function retry(fn, n = 4) {
  for (let i = 0; i < n; i++) {
    try { return await fn() } catch (e) { if (i === n - 1) throw e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))) }
  }
}

let TOKEN = null
async function getToken() {
  if (CFG.token) return CFG.token
  const res = await retry(() => fetch(`${CFG.host}/multipass/api/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CFG.clientId, client_secret: CFG.clientSecret }),
  }))
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()).access_token
}

async function api(method, pathname, body) {
  const res = await retry(() => fetch(`${CFG.host}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }))
  let json = null
  const text = await res.text()
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 300) } }
  return { status: res.status, json }
}

const O = `/api/v2/ontologies/${CFG.ontology}`

/* ---------- classification ----------------------------------------- */

const NA = "na" // action not used by the app for this type

// read: search pageSize 1
async function checkRead(objectType) {
  const { status, json } = await api("POST", `${O}/objects/${objectType}/search`, { pageSize: 1 })
  if (status === 200) return { code: "ok" }
  const name = json?.errorName || ""
  if (status === 403) return { code: "denied", note: "no read permission" }
  if (/ObjectTypeNotFound/.test(name)) return { code: "missing", note: "object type not found" }
  return { code: "error", note: `${status} ${name || (json.raw ?? "")}`.trim() }
}

// action: VALIDATE_ONLY — detects submit-permission without mutating
async function checkAction(actionApiName, parameters) {
  if (!actionApiName) return { code: NA }
  const { status, json } = await api("POST", `${O}/actions/${actionApiName}/apply`, {
    options: { mode: "VALIDATE_ONLY" },
    parameters,
  })
  const name = json?.errorName || ""
  if (/ActionTypeNotFound/.test(name)) return { code: "missing", note: "action not found" }
  if (status === 403) return { code: "denied", note: "forbidden" }
  const v = json?.validation
  if (!v) return { code: "error", note: `${status} ${name || (json.raw ?? "")}`.trim() }
  const subCrit = v.submissionCriteria ?? []
  const blocked = subCrit.find((c) => c.result === "INVALID")
  if (blocked) return { code: "denied", note: shortPerm(blocked.configuredFailureMessage) }
  // result VALID, or INVALID only on parameters (our dummy params) → submit permission OK
  return { code: "ok" }
}

function shortPerm(msg) {
  if (!msg) return "no submit permission"
  if (/group membership|permission/i.test(msg)) return "no submit permission"
  return msg.slice(0, 48)
}

/* ---------- representative params (structurally valid dummies) ------ */

const now = () => new Date().toISOString()
const E = CFG.email

// Object type → { read, create, edit, delete } action probes ("na" = app doesn't use it).
// `mediaRef` is a real temp media reference (uploaded once up front) so the
// DocMeta probes pass parameter validation and reach the permission check.
function buildMatrix(mediaRef, mediaItemRid) {
 return [
  {
    type: "OrbitDocsUserV2",
    create: ["create-orbit-docs-v3-user", { email: E, name: "Probe", role: "user", isOnboarded: false, isAllowedToUpload: false, dailyUploadLimit: 10, options: "{}", createdAt: now(), updatedAt: now() }],
    edit: ["edit-orbit-docs-v3-user", { OrbitDocsUser: E, name: "Probe", role: "user", isOnboarded: false, isAllowedToUpload: false, dailyUploadLimit: 10, options: "{}", createdAt: now(), updatedAt: now() }],
    delete: NA,
  },
  {
    type: "OrbitDocsFolderRegistry",
    create: ["create-orbit-docs-folder-registry", { name: "probe", parentFolderId: "folder-root", ownerUserId: E, createdTs: now(), allowedUserIds: [E] }],
    edit: ["edit-orbit-docs-folder-registry", { OrbitDocsFolderRegistry: "00000000-0000-0000-0000-000000000000", name: "probe", parentFolderId: "folder-root", ownerUserId: E, createdTs: now(), allowedUserIds: [E] }],
    delete: ["delete-orbit-docs-folder-registry", { OrbitDocsFolderRegistry: "00000000-0000-0000-0000-000000000000" }],
  },
  {
    type: "OrbitDocsDocMeta",
    create: ["create-orbit-docs-doc-meta", { fileName: "probe.pdf", mime: "application/pdf", mediaPath: "probe.pdf", mediaItemRid, mediaReference: mediaRef, parentFolderId: "folder-root", status: "uploaded", uploadTs: now(), userEmail: E, allowedUserIds: [E] }],
    edit: ["edit-orbit-docs-doc-meta", { OrbitDocsDocMeta: "probe", fileName: "probe.pdf", mime: "application/pdf", mediaPath: "probe.pdf", mediaItemRid, mediaReference: mediaRef, parentFolderId: "folder-root", status: "uploaded", uploadTs: now(), userEmail: E, allowedUserIds: [E] }],
    delete: ["delete-orbit-docs-doc-meta", { OrbitDocsDocMeta: "probe" }],
  },
  {
    type: "OrbitDocsChatSessions",
    create: ["create-orbit-docs-chat-sessions", { userEmail: E, title: "probe", summary: "", options: "{}", createdAt: now(), lastUpdatedAt: now(), isDeleted: false, activeLeafMessageId: "" }],
    edit: ["edit-orbit-docs-chat-sessions", { OrbitDocsChatSessions: "00000000-0000-0000-0000-000000000000", userEmail: E, title: "probe", summary: "", options: "{}", createdAt: now(), lastUpdatedAt: now(), isDeleted: false, activeLeafMessageId: "" }],
    delete: ["delete-orbit-docs-chat-sessions", { OrbitDocsChatSessions: "00000000-0000-0000-0000-000000000000" }],
  },
  {
    type: "OrbitDocsChatMessages",
    create: ["create-orbit-docs-chat-messages", { sessionId: "probe", role: "user", content: "probe", parentMessageId: "", scope: "{}", citations: "[]", model: "", createdAt: now(), isDeleted: false }],
    edit: NA,
    delete: ["delete-orbit-docs-chat-messages", { OrbitDocsChatMessages: "00000000-0000-0000-0000-000000000000" }],
  },
  {
    type: "OrbitDocsRateLimitGrants",
    create: ["create-orbit-docs-v3rate-limit-grants", { userEmail: E, bonusUploads: 5, validFrom: now(), validUntil: now(), reason: "probe", createdBy: E, createdAt: now() }],
    edit: NA,
    delete: NA,
  },
  { type: "OrbitDocsChunks", create: NA, edit: NA, delete: NA, readOnly: "pipeline-written" },
  { type: "OrbitDocsEntitiesCanonical", create: NA, edit: NA, delete: NA, readOnly: "pipeline-written" },
  { type: "OrbitDocsRelationships", create: NA, edit: NA, delete: NA, readOnly: "pipeline-written" },
 ]
}

/* ---------- rendering ---------------------------------------------- */

const G = (s) => `\x1b[32m${s}\x1b[0m`
const R = (s) => `\x1b[31m${s}\x1b[0m`
const Y = (s) => `\x1b[33m${s}\x1b[0m`
const DIM = (s) => `\x1b[2m${s}\x1b[0m`
const B = (s) => `\x1b[1m${s}\x1b[0m`

function cell(result) {
  if (!result || result.code === NA) return DIM("·")
  if (result.code === "ok") return G("✓")
  if (result.code === "missing") return Y("⊘")
  if (result.code === "denied") return R("✗")
  return R("!")
}

function pad(s, n) {
  // account for ansi
  const len = s.replace(/\x1b\[[0-9;]*m/g, "").length
  return s + " ".repeat(Math.max(0, n - len))
}

async function main() {
  if (!CFG.token && (!CFG.clientId || !CFG.clientSecret)) {
    console.error("Missing credentials: set CLIENT_ID/CLIENT_SECRET (or FOUNDRY_TOKEN) in .env")
    process.exit(2)
  }
  TOKEN = await getToken()

  console.log("")
  console.log(B("Foundry v3 permission check") + DIM(`  ·  ${CFG.email}`))
  console.log(DIM(`${CFG.host}  ·  ${CFG.ontology}`))
  console.log("")

  // Upload a temp media item up front: it doubles as the media-permission
  // check and provides a real MediaReference for the DocMeta action probes.
  const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF")
  const mediaRes = await retry(() => fetch(`${CFG.host}/api/v2/mediasets/media/upload?filename=perm-probe.pdf&preview=true`, {
    method: "PUT", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/octet-stream" }, body: pdf,
  }))
  const mediaOk = mediaRes.ok
  let mediaRef = null
  let mediaItemRid = "ri.mio.main.media-item.0"
  let mediaNote = "temp upload ok"
  if (mediaOk) {
    mediaRef = await mediaRes.json().catch(() => null)
    mediaItemRid = mediaRef?.reference?.mediaSetViewItem?.mediaItemRid ?? mediaItemRid
  } else {
    mediaNote = `${mediaRes.status} ${(await mediaRes.text().catch(() => "")).slice(0, 60)}`
  }

  const MATRIX = buildMatrix(mediaRef, mediaItemRid)

  const header = pad(B("OBJECT TYPE"), 34) + pad(B("read"), 8) + pad(B("create"), 9) + pad(B("edit"), 8) + "delete"
  console.log(header)
  console.log(DIM("─".repeat(64)))

  let readable = 0
  let actionsOk = 0
  let actionsTotal = 0
  const notes = []

  for (const row of MATRIX) {
    const read = await checkRead(row.type)
    if (read.code === "ok") readable++
    else notes.push(`${row.type} read: ${read.note}`)

    const results = { read }
    for (const kind of ["create", "edit", "delete"]) {
      const spec = row[kind]
      if (!spec || spec === NA) { results[kind] = { code: NA }; continue }
      const [name, params] = spec
      const r = await checkAction(name, params)
      results[kind] = r
      actionsTotal++
      if (r.code === "ok") actionsOk++
      else if (r.code !== NA) notes.push(`${name}: ${r.note}`)
    }

    let line = pad(row.type, 34) + pad(cell(results.read), 8) + pad(cell(results.create), 9) + pad(cell(results.edit), 8) + cell(results.delete)
    if (row.readOnly) line += DIM(`   ${row.readOnly}`)
    console.log(line)
  }

  console.log("")
  console.log(B("AGENT & MEDIA"))

  // Agent: create a throwaway AIP session
  const agent = await api("POST", `/api/v2/aipAgents/agents/${CFG.agentRid}/sessions?preview=true`, {})
  let agentCell, agentNote
  if (agent.status === 200) { agentCell = G("✓"); agentNote = "session created" }
  else {
    const blob = JSON.stringify(agent.json)
    if (/UnsupportedLanguageModel|AgentFailedValidation/.test(blob)) { agentCell = R("✗"); agentNote = "language model not accessible to this token" }
    else { agentCell = R("✗"); agentNote = `${agent.status} ${agent.json?.errorName ?? ""}`.trim() }
  }
  console.log(pad("  main agent (AIP session)", 34) + agentCell + DIM(`  ${agentNote}`))
  console.log(pad("  media upload (temp)", 34) + (mediaOk ? G("✓") : R("✗")) + DIM(`  ${mediaNote}`))

  /* legend + summary */
  console.log("")
  console.log(DIM(`${G("✓")} ok   ${R("✗")} no permission   ${Y("⊘")} missing   ${R("!")} error   ${DIM("·")} not used by app`))
  console.log("")
  const agentOk = agent.status === 200
  console.log(
    B("Summary  ") +
    `${readable}/${MATRIX.length} readable   ` +
    `${actionsOk}/${actionsTotal} actions writable   ` +
    `agent ${agentOk ? G("ok") : R("blocked")}   ` +
    `media ${mediaOk ? G("ok") : R("blocked")}`
  )
  if (notes.length) {
    console.log("")
    console.log(DIM("details:"))
    for (const n of [...new Set(notes)]) console.log(DIM(`  · ${n}`))
  }
  console.log("")

  const allGood = readable === MATRIX.length && actionsOk === actionsTotal && agentOk && mediaOk
  process.exit(allGood ? 0 : 1)
}

main().catch((e) => {
  console.error("check failed:", e.message)
  process.exit(2)
})
