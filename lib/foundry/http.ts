import "server-only"

import { NextResponse } from "next/server"

import { FoundryError } from "./client"
import { isFoundryConfigured } from "./config"
import { UserResolutionError } from "./user"

/** 503 guard: every route requires Foundry; the UI checks /config first. */
export function requireLive(): NextResponse | null {
  if (isFoundryConfigured()) return null
  return NextResponse.json(
    {
      error: "Foundry is not configured",
      hint: "Set FOUNDRY_TOKEN or FOUNDRY_CLIENT_ID/FOUNDRY_CLIENT_SECRET",
    },
    { status: 503 }
  )
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof UserResolutionError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof FoundryError) {
    return NextResponse.json(
      { error: error.message, detail: error.detail },
      { status: error.status >= 400 && error.status < 500 ? error.status : 502 }
    )
  }
  const message = error instanceof Error ? error.message : String(error)
  return NextResponse.json({ error: message }, { status: 500 })
}

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}
