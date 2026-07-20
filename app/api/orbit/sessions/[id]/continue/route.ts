import { NextResponse } from "next/server"

import { runSessionTurn } from "@/lib/foundry/chat"
import {
  getSessionRow,
  sanitizeAttachments,
  sessionOptions,
  updateSessionRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"
export const maxDuration = 300

/** Runs stuck in_progress longer than this no longer block a new turn. */
const RUN_STALE_MS = 6 * 60_000

/**
 * Persist the user message, run the v3 agent turn, and stream the markdown
 * reply straight through (plain chunks; errors arrive in-band with the
 * __orbit_stream_error__: sentinel).
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
      parentMessageId?: string | null
      personaId?: string | null
      docSkillId?: string | null
      docsAttached?: string[]
      foldersAttached?: string[]
    }
    const userInput = (body.userInput ?? "").trim()
    if (!userInput) {
      return json({ error: "userInput is required" }, { status: 422 })
    }

    const run = sessionOptions(session).currentRun
    if (run?.status === "in_progress") {
      const startedAt = Date.parse(run.startedAt ?? "")
      const active =
        !Number.isFinite(startedAt) || Date.now() - startedAt < RUN_STALE_MS
      if (active) {
        return json(
          {
            error:
              "A response is already being generated for this session. Please wait for it to complete.",
          },
          { status: 409 }
        )
      }
    }

    if (body.docsAttached !== undefined || body.foldersAttached !== undefined) {
      const sanitized = await sanitizeAttachments(
        userEmail,
        body.docsAttached ?? [],
        body.foldersAttached ?? []
      )
      await updateSessionRow(session, {
        options: {
          docsAttached: sanitized.docsAttached,
          foldersAttached: sanitized.foldersAttached,
        },
      })
      session = (await getSessionRow(id, userEmail)) ?? session
    }

    const options = sessionOptions(session)
    const scope = {
      documentIds: options.docsAttached ?? [],
      folderIds: options.foldersAttached ?? [],
    }

    const { stream } = await runSessionTurn({
      session,
      userEmail,
      userInput,
      parentMessageId: body.parentMessageId,
      scope,
      personaId: body.personaId,
      docSkillId: body.docSkillId,
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
