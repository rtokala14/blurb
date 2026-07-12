import { executeQuery } from "@/lib/foundry/client"
import { getFoundryConfig } from "@/lib/foundry/config"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"
export const maxDuration = 90

/** Refine text via the ontology refining-agent query (PoC /api/refine). */
export async function POST(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const body = (await request.json()) as {
      userInput?: string
      sessionRid?: string
      toRefine?: string
      refineRequest?: string
    }
    if (!body.userInput) {
      return json({ error: "userInput is required" }, { status: 422 })
    }
    const parameters: Record<string, unknown> = { userInput: body.userInput }
    if (body.sessionRid) parameters.sessionRid = body.sessionRid
    if (body.toRefine) parameters.toRefine = body.toRefine
    if (body.refineRequest) parameters.refineRequest = body.refineRequest

    const cfg = getFoundryConfig()
    const result = await executeQuery<unknown>(cfg.refineQueryApiName, parameters)
    return json({ text: extractRefineText(result), raw: result })
  } catch (error) {
    return errorResponse(error)
  }
}

/** Pull the text out of the query result (PoC _extract_refine_text). */
function extractRefineText(payload: unknown): string {
  if (typeof payload === "string") return payload
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>
    const value = record.value
    if (value && typeof value === "object") {
      const markdown = (value as Record<string, unknown>).markdownResponse
      if (typeof markdown === "string") return markdown
    }
    for (const key of ["text", "result", "output", "content", "value"]) {
      if (typeof record[key] === "string") return record[key] as string
    }
    for (const key of ["result", "output", "data"]) {
      const nested = record[key]
      if (nested && typeof nested === "object") {
        for (const nestedKey of ["text", "content", "value"]) {
          const item = (nested as Record<string, unknown>)[nestedKey]
          if (typeof item === "string") return item
        }
      }
    }
  }
  return JSON.stringify(payload)
}
