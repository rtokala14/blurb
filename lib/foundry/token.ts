import "server-only"

import { getFoundryConfig } from "./config"

/**
 * OAuth2 client-credentials token manager for Foundry.
 * Tokens are cached per process and refreshed 60s before expiry.
 * A static FOUNDRY_TOKEN, when present, always wins (simplest test path).
 */

interface CachedToken {
  accessToken: string
  /** epoch ms after which the token must be refreshed */
  refreshAfter: number
}

let cached: CachedToken | null = null
let inFlight: Promise<string> | null = null

const REFRESH_MARGIN_MS = 60_000

async function requestToken(): Promise<string> {
  const cfg = getFoundryConfig()
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error(
      "Foundry auth is not configured (set FOUNDRY_TOKEN or FOUNDRY_CLIENT_ID/FOUNDRY_CLIENT_SECRET)"
    )
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  })
  if (process.env.FOUNDRY_SCOPES) {
    body.set("scope", process.env.FOUNDRY_SCOPES)
  }

  const res = await fetch(`${cfg.hostname}/multipass/api/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(
      `Foundry token request failed (${res.status}): ${detail.slice(0, 300)}`
    )
  }
  const data = (await res.json()) as {
    access_token: string
    expires_in?: number
  }
  cached = {
    accessToken: data.access_token,
    refreshAfter:
      Date.now() + Math.max((data.expires_in ?? 3600) * 1000 - REFRESH_MARGIN_MS, 30_000),
  }
  return data.access_token
}

export async function getFoundryToken(): Promise<string> {
  const cfg = getFoundryConfig()
  if (cfg.staticToken) return cfg.staticToken
  if (cached && Date.now() < cached.refreshAfter) return cached.accessToken
  // de-dupe concurrent refreshes
  if (!inFlight) {
    inFlight = requestToken().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}
