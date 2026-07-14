import { executeQuery } from "@/lib/foundry/client"
import { getFoundryConfig } from "@/lib/foundry/config"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { complete, type LlmProvider } from "@/lib/foundry/llm-proxy"

export const dynamic = "force-dynamic"
export const maxDuration = 90

/**
 * Refine text into a polished draft.
 *
 * Two engines:
 *  - `query` (default): the ontology refining agent — grounded/prompted for the
 *    document envelope format (markdown conventions + `<source>` citation
 *    tags). Used for Studio doc edits, which depend on that exact behavior.
 *  - `llm-proxy`: a single completion via Foundry's vendor-native LLM proxy
 *    (OpenAI/Anthropic) — lower latency, model-flexible, no grounding. Used for
 *    lightweight tasks like email refining.
 *
 * The caller picks via `engine`. The `REFINE_ENGINE` env var overrides the
 * default when a request doesn't specify one.
 */
export async function POST(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const body = (await request.json()) as {
      userInput?: string
      sessionRid?: string
      toRefine?: string
      refineRequest?: string
      /** which engine to use; falls back to REFINE_ENGINE, then "query" */
      engine?: "query" | "llm-proxy"
      /** optional per-request model overrides (llm-proxy engine) */
      provider?: LlmProvider
      model?: string
    }
    if (!body.userInput) {
      return json({ error: "userInput is required" }, { status: 422 })
    }

    const engine =
      body.engine ??
      (process.env.REFINE_ENGINE === "llm-proxy" ? "llm-proxy" : "query")
    if (engine === "llm-proxy") {
      const text = await refineViaProxy({ ...body, userInput: body.userInput })
      return json({ text, engine: "llm-proxy" })
    }

    const parameters: Record<string, unknown> = { userInput: body.userInput }
    if (body.sessionRid) parameters.sessionRid = body.sessionRid
    if (body.toRefine) parameters.toRefine = body.toRefine
    if (body.refineRequest) parameters.refineRequest = body.refineRequest

    const cfg = getFoundryConfig()
    const result = await executeQuery<unknown>(cfg.refineQueryApiName, parameters)
    return json({ text: extractRefineText(result), raw: result, engine: "query" })
  } catch (error) {
    return errorResponse(error)
  }
}

/** Refine via the LLM proxy: a single system+user completion. */
async function refineViaProxy(body: {
  userInput: string
  toRefine?: string
  refineRequest?: string
  provider?: LlmProvider
  model?: string
}): Promise<string> {
  const instruction =
    body.refineRequest?.trim() ||
    "Refine the text into a clear, professional draft. Return only the rewritten text."
  const source = body.toRefine?.trim() || body.userInput.trim()

  return complete({
    provider: body.provider,
    model: body.model,
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content:
          "You are an expert editor. Follow the user's rewrite instruction " +
          "exactly. Preserve any citation markers like [1] verbatim. Output " +
          "only the rewritten text — no preamble, no code fences, no commentary.",
      },
      {
        role: "user",
        content: `Rewrite instruction:\n${instruction}\n\nText to rewrite:\n${source}`,
      },
    ],
  })
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
