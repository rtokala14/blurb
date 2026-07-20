import "server-only"

/**
 * Foundry connection configuration (server-side only).
 *
 * The app is live-only: API routes proxy to Palantir Foundry via plain REST
 * against the v3 OSDK surface (orbit-docs-openapi.yaml). If credentials
 * aren't configured, /api/orbit/config reports it and routes hard-error via
 * requireLive() — there is no offline/simulated fallback.
 *
 * Auth options (either):
 *  - FOUNDRY_CLIENT_ID + FOUNDRY_CLIENT_SECRET → OAuth2 client-credentials
 *    against {host}/multipass/api/oauth2/token
 *  - FOUNDRY_TOKEN → static bearer token
 */

export interface FoundryConfig {
  hostname: string
  ontology: string
  clientId?: string
  clientSecret?: string
  staticToken?: string
  userEmail: string
  /**
   * The v3 main chat agent (AIP Chatbot), driven via the platform Sessions
   * API: create session → streamingContinue with {Files, Folders} objectSet
   * parameters. The ontology-query wrapper (orbitDocsV3MainAgent) exists too
   * but the platform API is preferred (real token streaming + traces).
   */
  agentRid: string
  mainAgentQueryApiName: string
  /**
   * Foundry's vendor-native LLM proxy. Exposes OpenAI- and Anthropic-compatible
   * endpoints under {host}/api/v2/llm/proxy/{provider}/v1, authenticated with
   * the same Foundry bearer token. Used for text tasks (email/doc refining,
   * session titles/summaries) that don't need the grounded document agent.
   *
   * Verified-available proxy models (2026-07): OpenAI gpt-4o, gpt-4.1,
   * gpt-4.1-mini, gpt-5, gpt-5-mini; Anthropic claude-haiku-4-5,
   * claude-sonnet-4-5, claude-opus-4-1.
   *
   * `model` is the general default (refine, etc.). `metadataModel` is a fast,
   * cheap model reserved for auto title/summary generation.
   */
  llmProxy: {
    provider: "openai" | "anthropic"
    model: string
    metadataProvider: "openai" | "anthropic"
    metadataModel: string
    maxTokens: number
  }
  /** engine for /api/orbit/refine — the v3 stack defaults to the LLM proxy */
  refineEngine: "llm-proxy" | "query"
  refineQueryApiName: string
}

const DEFAULT_HOSTNAME = "https://jacobs.palantirfoundry.com"

function normalizeHostname(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "")
  if (!trimmed) return DEFAULT_HOSTNAME
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function getFoundryConfig(): FoundryConfig {
  return {
    hostname: normalizeHostname(process.env.FOUNDRY_HOSTNAME || DEFAULT_HOSTNAME),
    ontology: process.env.FOUNDRY_ONTOLOGY || "jacobs-ontology",
    clientId: process.env.FOUNDRY_CLIENT_ID || process.env.CLIENT_ID || undefined,
    clientSecret:
      process.env.FOUNDRY_CLIENT_SECRET || process.env.CLIENT_SECRET || undefined,
    staticToken: process.env.FOUNDRY_TOKEN || undefined,
    userEmail: (process.env.ORBIT_USER_EMAIL || "rohit.tokala@jacobs.com")
      .trim()
      .toLowerCase(),
    agentRid:
      process.env.PRIMARY_AGENT_RID ||
      "ri.aip-agents..agent.2addece7-23d3-4d5f-b521-27747fce8806",
    mainAgentQueryApiName:
      process.env.ORBIT_MAIN_AGENT_QUERY || "orbitDocsV3MainAgent",
    llmProxy: {
      provider:
        process.env.LLM_PROXY_PROVIDER === "anthropic" ? "anthropic" : "openai",
      model:
        process.env.LLM_PROXY_MODEL ||
        (process.env.LLM_PROXY_PROVIDER === "anthropic"
          ? "claude-sonnet-4-5"
          : "gpt-4.1"),
      metadataProvider:
        process.env.LLM_METADATA_PROVIDER === "anthropic"
          ? "anthropic"
          : "openai",
      metadataModel: process.env.LLM_METADATA_MODEL || "gpt-5-mini",
      maxTokens: Number(process.env.LLM_PROXY_MAX_TOKENS) || 2048,
    },
    refineEngine: process.env.REFINE_ENGINE === "query" ? "query" : "llm-proxy",
    refineQueryApiName:
      process.env.REFINE_QUERY_API_NAME || "dgiiDocAiRefiningAgent",
  }
}

/** Live when either auth mechanism is configured. */
export function isFoundryConfigured(): boolean {
  const cfg = getFoundryConfig()
  return Boolean(cfg.staticToken || (cfg.clientId && cfg.clientSecret))
}
