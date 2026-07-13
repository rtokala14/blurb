import "server-only"

import {
  createAipSession,
  getAipSessionContent,
  getSessionTrace,
  streamingContinue,
} from "./client"
import { getFoundryConfig } from "./config"
import { buildDocSkillPrompt, getDocSkill } from "@/lib/docgen/skills"
import { personaPreambleForId } from "@/lib/personas"
import {
  createBranchRow,
  createMessageRow,
  getSessionBranches,
  getSessionMessages,
  pk,
  updateBranchRow,
  updateSessionRow,
  type BranchRow,
  type MessageRow,
  type SessionRow,
} from "./ontology"
import {
  buildSummaryPrompt,
  buildTitlePrompt,
  encodeStreamError,
  normalizeMode,
  normalizeTitle,
  prepareTurnRequest,
  STREAM_ERROR_PREFIX,
} from "./turn"

/**
 * One agent turn: persist the user message, stream the assistant reply
 * straight through, then persist the reply and run state. Mirrors the PoC's
 * /api/sessions/{id}/continue.
 */

export interface RunTurnParams {
  session: SessionRow
  userEmail: string
  userInput: string
  mode?: string | null
  branchId?: string | null
  parentMessageId?: string | null
  messageId?: string | null
  sessionTraceId?: string | null
  scopedDocIds: string[]
  /** optional persona attached to this session (built-in registry id) */
  personaId?: string | null
  /** optional document skill pack — turns this into a generation turn */
  docSkillId?: string | null
}

export interface RunTurnResult {
  stream: ReadableStream<Uint8Array>
}

export async function runSessionTurn(params: RunTurnParams): Promise<RunTurnResult> {
  const cfg = getFoundryConfig()
  const sessionId = pk(params.session)
  const requestedMode = normalizeMode(params.mode ?? params.session.mode)

  const [persistedMessages, branches] = await Promise.all([
    getSessionMessages(sessionId),
    getSessionBranches(sessionId),
  ])
  const targetBranchId =
    params.branchId || params.session.activeBranchId || undefined
  const targetBranch = branches.find((b) => pk(b) === targetBranchId)
  const parentMessageId =
    params.parentMessageId || targetBranch?.headMessageId || undefined

  const turn = prepareTurnRequest({
    mode: requestedMode,
    summary: params.session.summary,
    persistedMessages: persistedMessages.map((m) => ({
      id: pk(m),
      isAgent: Boolean(m.isAgent),
      message: m.message ?? "",
      createdAt: m.createdAt,
    })),
    userInput: params.userInput,
    userDocs: params.scopedDocIds,
    ontology: cfg.ontology,
    agents: { primary: cfg.agents.primary, thinking: cfg.agents.thinking },
    pinnedAgentRid: params.session.currentAgentRid,
    pinnedAgentVersion: params.session.currentAgentVersion,
    personaPreamble: personaPreambleForId(params.personaId),
    docSkillPrompt: (() => {
      const skill = getDocSkill(params.docSkillId)
      return skill ? buildDocSkillPrompt(skill) : undefined
    })(),
  })

  // AIP session creation is a slow network call independent of persistence —
  // run them concurrently (PoC optimization).
  const aipSessionPromise = createAipSession(turn.agentRid, turn.agentVersion)

  const userMessageId = await createMessageRow({
    sessionId,
    message: params.userInput.trim(),
    isAgent: false,
    mode: requestedMode,
    branchId: targetBranchId,
    parentMessageId,
    branchIndex: persistedMessages.length,
  })
  if (targetBranch) {
    await updateBranchRow(targetBranch, { headMessageId: userMessageId })
  }

  const aipSession = await aipSessionPromise
  const messageId = params.messageId || crypto.randomUUID()
  const traceId = params.sessionTraceId || crypto.randomUUID()

  await updateSessionRow(sessionId, {
    mode: requestedMode,
    currentAgentRid: turn.agentRid,
    currentAgentVersion: aipSession.agentVersion ?? turn.agentVersion ?? undefined,
    currentSessionId: aipSession.rid,
    currentMessageId: messageId,
    currentSessionTraceId: traceId,
    currentRunStatus: "in_progress",
    currentRunError: undefined,
    activeBranchId: targetBranchId,
    updatedAt: new Date().toISOString(),
  })

  const upstream = await streamingContinue({
    agentRid: turn.agentRid,
    sessionRid: aipSession.rid,
    userInput: turn.userInput,
    parameterInputs: turn.parameterInputs,
    messageId,
    sessionTraceId: traceId,
  })

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "")
    await persistFailedRun(sessionId, detail || `HTTP ${upstream.status}`)
    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(encodeStreamError(detail || `HTTP ${upstream.status}`))
          )
          controller.close()
        },
      }),
    }
  }

  const upstreamBody = upstream.body
  let collected = ""

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstreamBody.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            collected += decoder.decode(value, { stream: true })
            controller.enqueue(value)
          }
        }
        collected += decoder.decode()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await persistFailedRun(sessionId, message)
        controller.enqueue(encoder.encode(encodeStreamError(message)))
        controller.close()
        return
      }

      try {
        const finalText = collected.trim()
        if (finalText.startsWith(STREAM_ERROR_PREFIX)) {
          await persistFailedRun(sessionId, finalText.slice(STREAM_ERROR_PREFIX.length))
        } else if (finalText) {
          const agentMessageId = await createMessageRow({
            sessionId,
            message: finalText,
            isAgent: true,
            mode: requestedMode,
            branchId: targetBranchId,
            parentMessageId: userMessageId,
            branchIndex: persistedMessages.length + 1,
          })
          if (targetBranch) {
            await updateBranchRow(targetBranch, { headMessageId: agentMessageId })
          }
          await updateSessionRow(sessionId, {
            currentRunStatus: "idle",
            currentRunError: undefined,
            currentMessageId: undefined,
            currentSessionTraceId: undefined,
            activeBranchId: targetBranchId,
            updatedAt: new Date().toISOString(),
          })
          // Fire-and-forget: summary + auto-title via the metadata agent.
          void refreshSessionMetadata(sessionId).catch(() => undefined)
        }
      } catch {
        // Persistence failure after a successful stream: mark run failed so
        // the run endpoint can recover from AIP session content.
        await persistFailedRun(sessionId, "Failed to persist assistant reply")
      }
      controller.close()
    },
    cancel() {
      void upstreamBody.cancel().catch(() => undefined)
    },
  })

  return { stream }
}

export async function persistFailedRun(
  sessionId: string,
  errorMessage: string
): Promise<void> {
  await updateSessionRow(sessionId, {
    currentRunStatus: "failed",
    currentRunError: errorMessage.slice(0, 4000),
    updatedAt: new Date().toISOString(),
  }).catch(() => undefined)
}

/* ------------------------------------------------------------------ */
/* Run recovery (PoC GET /api/sessions/{id}/run)                        */
/* ------------------------------------------------------------------ */

export async function getRunStatus(session: SessionRow) {
  const payload = (status?: string, traceStatus?: string | null) => ({
    status: status ?? session.currentRunStatus ?? "idle",
    sessionId: pk(session),
    agentRid: session.currentAgentRid ?? null,
    agentVersion: session.currentAgentVersion ?? null,
    currentSessionId: session.currentSessionId ?? null,
    messageId: session.currentMessageId ?? null,
    sessionTraceId: session.currentSessionTraceId ?? null,
    traceStatus: traceStatus ?? null,
    error: session.currentRunError ?? null,
  })

  if ((session.currentRunStatus ?? "idle") !== "in_progress") return payload()

  if (
    !session.currentAgentRid ||
    !session.currentSessionId ||
    !session.currentSessionTraceId
  ) {
    return payload("in_progress")
  }
  const trace = await getSessionTrace(
    session.currentAgentRid,
    session.currentSessionId,
    session.currentSessionTraceId
  )
  if (!trace) return payload("in_progress")
  if (trace.status === "COMPLETE") {
    await finalizeCompletedRun(session)
    return payload("complete", "COMPLETE")
  }
  return payload("in_progress", trace.status ?? null)
}

/** Recover the assistant reply from AIP session content after a dropped stream. */
async function finalizeCompletedRun(session: SessionRow): Promise<void> {
  const sessionId = pk(session)
  if (!session.currentAgentRid || !session.currentSessionId) return
  const content = await getAipSessionContent(
    session.currentAgentRid,
    session.currentSessionId
  )
  const exchanges = content?.exchanges ?? []
  const lastExchange = exchanges[exchanges.length - 1]
  const messages = await getSessionMessages(sessionId)
  const latest = messages[messages.length - 1]
  if (lastExchange && !(latest && latest.isAgent)) {
    await createMessageRow({
      sessionId,
      message: lastExchange.result?.agentMarkdownResponse ?? "",
      isAgent: true,
      mode: normalizeMode(session.mode),
      branchId: session.activeBranchId ?? undefined,
      parentMessageId: latest ? pk(latest) : undefined,
      branchIndex: messages.length,
    })
  }
  await updateSessionRow(sessionId, {
    currentRunStatus: "idle",
    currentRunError: undefined,
    currentMessageId: undefined,
    currentSessionTraceId: undefined,
    updatedAt: new Date().toISOString(),
  })
  void refreshSessionMetadata(sessionId).catch(() => undefined)
}

/* ------------------------------------------------------------------ */
/* Session metadata refresh (summary + auto-title)                      */
/* ------------------------------------------------------------------ */

const TRANSCRIPT_LIMIT = 120_000

function serializeTranscript(messages: MessageRow[]): string {
  const lines: string[] = []
  let total = 0
  for (const message of messages) {
    const role = message.isAgent ? "Assistant" : "User"
    const entry = `${role}:\n${(message.message ?? "").trim()}\n`
    if (total + entry.length > TRANSCRIPT_LIMIT) {
      lines.push("[Transcript truncated to stay within the summarization limit.]")
      break
    }
    lines.push(entry)
    total += entry.length
  }
  return lines.join("\n").trim()
}

async function generateAgentText(prompt: string): Promise<string | null> {
  const cfg = getFoundryConfig()
  const session = await createAipSession(
    cfg.agents.metadata,
    cfg.agents.metadataVersion
  )
  const response = await streamingContinue({
    agentRid: cfg.agents.metadata,
    sessionRid: session.rid,
    userInput: prompt,
    messageId: crypto.randomUUID(),
    sessionTraceId: crypto.randomUUID(),
  })
  if (!response.ok || !response.body) return null
  const text = (await response.text()).trim()
  if (!text || text.startsWith(STREAM_ERROR_PREFIX)) return null
  return text
}

export async function refreshSessionMetadata(sessionId: string): Promise<void> {
  const { getObject } = await import("./client")
  const session = await getObject<SessionRow>("OrbitDocsUserSessions", sessionId)
  if (!session) return
  const messages = await getSessionMessages(sessionId)
  const transcript = serializeTranscript(messages)
  if (!transcript) return

  const fields: Record<string, unknown> = {}
  const summary = await generateAgentText(buildSummaryPrompt(transcript)).catch(
    () => null
  )
  if (summary !== null) fields.summary = summary.trim()

  if ((session.title || "New chat") === "New chat") {
    const title = await generateAgentText(
      buildTitlePrompt(transcript.slice(0, 12_000))
    ).catch(() => null)
    if (title !== null) fields.title = normalizeTitle(title)
  }

  if (Object.keys(fields).length === 0) return
  fields.updatedAt = new Date().toISOString()
  await updateSessionRow(sessionId, fields)
}

/* ------------------------------------------------------------------ */
/* Branch bootstrap for legacy sessions                                 */
/* ------------------------------------------------------------------ */

/**
 * Light version of the PoC's branching repair: guarantee a main branch
 * exists (non-destructive; skips per-message lineage rewrites).
 */
export async function ensureMainBranch(
  session: SessionRow,
  userEmail: string
): Promise<{ session: SessionRow; branches: BranchRow[] }> {
  let branches = await getSessionBranches(pk(session))
  let current = session
  if (branches.length === 0) {
    const messages = await getSessionMessages(pk(session))
    const last = messages[messages.length - 1]
    const branchId = await createBranchRow({
      sessionId: pk(session),
      createdBy: userEmail,
      name: "main",
      isDefault: true,
      anchorMessageId: last ? pk(last) : null,
    })
    current =
      (await updateSessionRow(pk(session), {
        activeBranchId: branchId,
        defaultBranchId: branchId,
        updatedAt: new Date().toISOString(),
      })) ?? session
    branches = await getSessionBranches(pk(session))
  }
  return { session: current, branches }
}
