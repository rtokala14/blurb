import { NextResponse } from "next/server"

import { runSessionTurn } from "@/lib/foundry/chat"
import {
  getSessionRow,
  sanitizeAttachments,
  updateSessionRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * Persist the user message, run the agent turn on Foundry, and stream the
 * markdown reply straight through (plain text chunks, PoC protocol: errors
 * arrive in-band with the __orbit_stream_error__: sentinel).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const { id } = await params
    const userEmail = await resolveRequestUser(request)
    let session = await getSessionRow(id, userEmail)
    if (!session) return json({ error: "Session not found" }, { status: 404 })

    const body = (await request.json()) as {
      userInput?: string
      mode?: string
      messageId?: string
      sessionTraceId?: string
      branchId?: string
      parentMessageId?: string
      personaId?: string | null
    }
    const userInput = (body.userInput ?? "").trim()
    if (!userInput) return json({ error: "userInput is required" }, { status: 422 })

    if ((session.currentRunStatus ?? "idle") === "in_progress") {
      return json(
        {
          error:
            "A response is already being generated for this session. Please wait for it to complete.",
        },
        { status: 409 }
      )
    }

    // Re-sanitize attachments against current access (PoC behavior).
    const sanitized = await sanitizeAttachments(
      userEmail,
      (session.docsAttached ?? []).map(String),
      (session.foldersAttached ?? []).map(String)
    )
    if (sanitized.scopedDocIds.length === 0) {
      return json(
        {
          error:
            "No accessible documents are attached to this session. Select documents and try again.",
        },
        { status: 422 }
      )
    }
    const attachmentsChanged =
      JSON.stringify(sanitized.docsAttached) !==
        JSON.stringify((session.docsAttached ?? []).map(String)) ||
      JSON.stringify(sanitized.foldersAttached) !==
        JSON.stringify((session.foldersAttached ?? []).map(String))
    if (attachmentsChanged) {
      session =
        (await updateSessionRow(id, {
          docsAttached: sanitized.docsAttached,
          foldersAttached: sanitized.foldersAttached,
          updatedAt: new Date().toISOString(),
        })) ?? session
    }

    const { stream } = await runSessionTurn({
      session,
      userEmail,
      userInput,
      mode: body.mode,
      branchId: body.branchId,
      parentMessageId: body.parentMessageId,
      messageId: body.messageId,
      sessionTraceId: body.sessionTraceId,
      scopedDocIds: sanitized.scopedDocIds,
      personaId: body.personaId,
    })

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
