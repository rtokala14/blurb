import "server-only"

/**
 * Foundry connection configuration (server-side only).
 *
 * The app runs in two modes:
 *  - "demo": no credentials configured — the UI uses its built-in simulated
 *    data so every surface stays reviewable.
 *  - "live": credentials present — API routes proxy to Palantir Foundry via
 *    plain REST (per the platform openapi.yml; no Foundry SDK).
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
  agents: {
    primary: string
    thinking: string
    metadata: string
    metadataVersion?: string
  }
  refineQueryApiName: string
}

const DEFAULT_HOSTNAME = "https://jacobs.palantirfoundry.com"

function normalizeHostname(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "")
  if (!trimmed) return DEFAULT_HOSTNAME
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function getFoundryConfig(): FoundryConfig {
  const primary =
    process.env.PRIMARY_AGENT_RID ||
    "ri.aip-agents..agent.b5324c77-83b4-4edb-806a-1d16cc7002a5"
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
    agents: {
      primary,
      thinking:
        process.env.DEEP_RESEARCH_AGENT_RID ||
        "ri.aip-agents..agent.01ce23ea-9165-48a2-94e2-90ad39f2d7e8",
      metadata: process.env.SESSION_METADATA_AGENT_RID || primary,
      metadataVersion: process.env.SESSION_METADATA_AGENT_VERSION || undefined,
    },
    refineQueryApiName:
      process.env.REFINE_QUERY_API_NAME || "dgiiDocAiRefiningAgent",
  }
}

/** Live when either auth mechanism is configured. */
export function isFoundryConfigured(): boolean {
  const cfg = getFoundryConfig()
  return Boolean(cfg.staticToken || (cfg.clientId && cfg.clientSecret))
}
