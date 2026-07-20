import "server-only"

import {
  createAipSession,
  FoundryError,
  streamingContinue,
} from "./client"
import { getFoundryConfig } from "./config"
import { buildDocSkillPrompt, getDocSkill } from "@/lib/docgen/skills"
import { complete } from "./llm-proxy"
import { personaPreambleForId } from "@/lib/personas"
import {
  createMessageRow,
  getDocsByIds,
  getSessionMessages,
  getSessionRow,
  listDocsInFolders,
  pk,
  resolveChunkOwnerIds,
  sessionOptions,
  updateSessionRow,
  type MessageRow,
  type SessionRow,
} from "./ontology"
import {
  buildParameterInputs,
  buildSummaryPrompt,
  buildTitlePrompt,
  composeTurnInput,
  encodeStreamError,
  normalizeTitle,
  STREAM_ERROR_PREFIX,
  type TurnScope,
} from "./turn"

/**
 * One v3 agent turn, driven via the AIP platform Sessions API:
 *  1. persist the user message (parent = active leaf, or an explicit parent
 *     for branch/regenerate turns),
 *  2. reuse (or create) the chat session's AIP session and call
 *     streamingContinue with the Files/Folders objectSet parameters,
 *  3. pipe the token stream straight through to the client while collecting,
 *  4. persist the assistant message as the user message's child and repoint
 *     the session's activeLeafMessageId at it.
 *
 * Errors travel in-band with the __orbit_stream_error__ sentinel — the
 * client protocol is unchanged from the PoC.
 */

export interface RunTurnParams {
  session: SessionRow
  userEmail: string
  userInput: string
  /** parent for the new user message; defaults to the active leaf */
  parentMessageId?: string | null
  scope: TurnScope
  /** optional persona attached to this session (built-in registry id) */
  personaId?: string | null
  /** optional document skill pack — turns this into a generation turn */
  docSkillId?: string | null
}

export interface RunTurnResult {
  stream: ReadableStream<Uint8Array>
}

/** AIP session reuse: recreate when the stored session went away/expired. */
function isSessionGone(error: unknown): boolean {
  if (!(error instanceof FoundryError)) return false
  return (
    error.status === 404 ||
    /SessionNotFound|SessionExpired/i.test(error.detail ?? "")
  )
}

async function openTurnStream(
  agentSessionRid: string | undefined,
  input: {
    userInput: string
    parameterInputs: Record<string, unknown>
  }
): Promise<{ upstream: Response; sessionRid: string }> {
  const cfg = getFoundryConfig()
  let sessionRid = agentSessionRid?.trim() || ""
  if (!sessionRid) {
    sessionRid = (await createAipSession(cfg.agentRid)).rid
  }
  const attempt = () =>
    streamingContinue({
      agentRid: cfg.agentRid,
      sessionRid,
      userInput: input.userInput,
      parameterInputs: input.parameterInputs,
      messageId: crypto.randomUUID(),
      sessionTraceId: crypto.randomUUID(),
    })
  let upstream = await attempt()
  if (!upstream.ok && agentSessionRid) {
    // Stored AIP session may have expired — retry once on a fresh session.
    const detail = await upstream.text().catch(() => "")
    if (
      upstream.status === 404 ||
      /SessionNotFound|SessionExpired/i.test(detail)
    ) {
      sessionRid = (await createAipSession(cfg.agentRid)).rid
      upstream = await attempt()
    } else {
      throw new FoundryError(
        `Agent turn failed (${upstream.status})`,
        upstream.status,
        detail.slice(0, 2000)
      )
    }
  }
  return { upstream, sessionRid }
}

/**
 * Translate the UI scope into the identities the agent's retrieval joins on.
 * Chunk attribution keys by the pipeline's documentId (fileName for
 * pipeline-registered rows), not the app's UUID DocMeta id, so the Files
 * objectSet must reference the chunk-owning rows or the agent sees no
 * chunks. Folder scope is expanded to its docs here for the same reason:
 * the chunk-owning rows sit in folder-root, not the user's folders, so
 * first-party Folders scoping cannot reach them. On any resolution failure
 * the raw scope is passed through — degraded retrieval beats a failed turn.
 */
async function buildRetrievalScope(
  scope: TurnScope,
  userEmail: string
): Promise<TurnScope> {
  try {
    const [docsById, folderDocs] = await Promise.all([
      getDocsByIds(scope.documentIds),
      listDocsInFolders(scope.folderIds, userEmail),
    ])
    const owners = await resolveChunkOwnerIds([
      ...docsById.values(),
      ...folderDocs,
    ])
    const documentIds = [
      ...new Set([
        ...scope.documentIds.map((id) => owners.get(id) ?? id),
        ...folderDocs.map((doc) => owners.get(pk(doc)) ?? pk(doc)),
      ]),
    ]
    return { documentIds, folderIds: scope.folderIds }
  } catch {
    return scope
  }
}

export async function runSessionTurn(
  params: RunTurnParams
): Promise<RunTurnResult> {
  const cfg = getFoundryConfig()
  const session = params.session
  const sessionId = pk(session)
  const options = sessionOptions(session)
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  /* undefined = continue from the active leaf; an explicit null/"" is a
     root turn (regenerate / edit-and-resend of the session's first message)
     and must NOT fall through to the leaf, or the new branch mis-parents. */
  const parentMessageId =
    params.parentMessageId === undefined
      ? (session.activeLeafMessageId ?? "")
      : (params.parentMessageId ?? "")

  const userMessageId = await createMessageRow({
    sessionId,
    role: "user",
    content: params.userInput.trim(),
    parentMessageId,
    scope: params.scope,
  })

  await updateSessionRow(session, {
    activeLeafMessageId: userMessageId,
    options: {
      currentRun: {
        status: "in_progress",
        messageId: userMessageId,
        startedAt: new Date().toISOString(),
      },
    },
  })

  const skill = getDocSkill(params.docSkillId)
  const input = composeTurnInput({
    userInput: params.userInput,
    personaPreamble: personaPreambleForId(params.personaId),
    docSkillPrompt: skill ? buildDocSkillPrompt(skill) : undefined,
  })
  const parameterInputs = buildParameterInputs(
    await buildRetrievalScope(params.scope, params.userEmail),
    cfg.ontology
  )

  const failTurn = async (message: string): Promise<RunTurnResult> => {
    await persistFailedRun(sessionId, params.userEmail, message)
    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(encodeStreamError(message)))
          controller.close()
        },
      }),
    }
  }

  let opened: Awaited<ReturnType<typeof openTurnStream>>
  try {
    opened = await openTurnStream(options.agentSessionRid, {
      userInput: input,
      parameterInputs,
    })
  } catch (error) {
    const message =
      error instanceof FoundryError
        ? `${error.message}${error.detail ? ` — ${error.detail}` : ""}`
        : error instanceof Error
          ? error.message
          : String(error)
    return failTurn(message)
  }

  const { upstream, sessionRid } = opened
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "")
    return failTurn(detail || `HTTP ${upstream.status}`)
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
        await persistFailedRun(sessionId, params.userEmail, message)
        controller.enqueue(encoder.encode(encodeStreamError(message)))
        controller.close()
        return
      }

      try {
        const finalText = collected.trim()
        if (finalText.startsWith(STREAM_ERROR_PREFIX)) {
          await persistFailedRun(
            sessionId,
            params.userEmail,
            finalText.slice(STREAM_ERROR_PREFIX.length)
          )
        } else if (finalText) {
          const agentMessageId = await createMessageRow({
            sessionId,
            role: "assistant",
            content: finalText,
            parentMessageId: userMessageId,
            scope: params.scope,
            model: cfg.agentRid,
          })
          // Re-read so the leaf/options merge is against current state.
          const fresh =
            (await getSessionRow(sessionId, params.userEmail)) ?? session
          await updateSessionRow(fresh, {
            activeLeafMessageId: agentMessageId,
            options: {
              agentSessionRid: sessionRid,
              currentRun: { status: "idle" },
            },
          })
          void refreshSessionMetadata(sessionId, params.userEmail).catch(
            () => undefined
          )
        } else {
          await persistFailedRun(
            sessionId,
            params.userEmail,
            "Agent returned an empty response"
          )
        }
      } catch {
        await persistFailedRun(
          sessionId,
          params.userEmail,
          "Failed to persist assistant reply"
        )
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
  userEmail: string,
  errorMessage: string
): Promise<void> {
  const session = await getSessionRow(sessionId, userEmail).catch(() => null)
  if (!session) return
  await updateSessionRow(session, {
    options: {
      currentRun: {
        status: "failed",
        error: errorMessage.slice(0, 4000),
      },
    },
  }).catch(() => undefined)
}

/* ------------------------------------------------------------------ */
/* Run status (GET /api/orbit/sessions/{id}/run)                        */
/* ------------------------------------------------------------------ */

/** Runs stuck in_progress longer than this are reported failed. */
const RUN_STALE_MS = 6 * 60_000

export function getRunStatus(session: SessionRow) {
  const run = sessionOptions(session).currentRun ?? {}
  let status = run.status ?? "idle"
  if (status === "in_progress") {
    const startedAt = Date.parse(run.startedAt ?? "")
    if (Number.isFinite(startedAt) && Date.now() - startedAt > RUN_STALE_MS) {
      status = "failed"
    }
  }
  return {
    status,
    sessionId: pk(session),
    messageId: run.messageId ?? null,
    error: run.error ?? null,
    activeLeafMessageId: session.activeLeafMessageId || null,
  }
}

/* ------------------------------------------------------------------ */
/* Session metadata refresh (summary + auto-title via LLM proxy)        */
/* ------------------------------------------------------------------ */

const TRANSCRIPT_LIMIT = 120_000

function serializeTranscript(messages: MessageRow[]): string {
  const lines: string[] = []
  let total = 0
  for (const message of messages) {
    const role = message.role === "assistant" ? "Assistant" : "User"
    const entry = `${role}:\n${(message.content ?? "").trim()}\n`
    if (total + entry.length > TRANSCRIPT_LIMIT) {
      lines.push("[Transcript truncated to stay within the summarization limit.]")
      break
    }
    lines.push(entry)
    total += entry.length
  }
  return lines.join("\n").trim()
}

async function generateText(prompt: string): Promise<string | null> {
  const cfg = getFoundryConfig()
  try {
    const text = await complete({
      provider: cfg.llmProxy.metadataProvider,
      model: cfg.llmProxy.metadataModel,
      // reasoning models spend tokens thinking before the (short) answer —
      // give headroom so titles/summaries aren't truncated to empty.
      maxTokens: 1536,
      messages: [{ role: "user", content: prompt }],
    })
    return text.trim() || null
  } catch {
    return null
  }
}

export async function refreshSessionMetadata(
  sessionId: string,
  userEmail: string
): Promise<void> {
  const session = await getSessionRow(sessionId, userEmail)
  if (!session) return
  const messages = await getSessionMessages(sessionId)
  const transcript = serializeTranscript(messages)
  if (!transcript) return

  const fields: { summary?: string; title?: string } = {}
  const summary = await generateText(buildSummaryPrompt(transcript))
  if (summary !== null) fields.summary = summary

  if ((session.title || "New chat") === "New chat") {
    const title = await generateText(buildTitlePrompt(transcript.slice(0, 12_000)))
    if (title !== null) fields.title = normalizeTitle(title)
  }

  if (Object.keys(fields).length === 0) return
  const fresh = (await getSessionRow(sessionId, userEmail)) ?? session
  await updateSessionRow(fresh, fields)
}
