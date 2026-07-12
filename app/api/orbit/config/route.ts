import { NextResponse } from "next/server"

import { getFoundryConfig, isFoundryConfigured } from "@/lib/foundry/config"

export const dynamic = "force-dynamic"

/** Mode probe: the client decides between demo simulation and live Foundry. */
export async function GET() {
  const live = isFoundryConfigured()
  const cfg = getFoundryConfig()
  return NextResponse.json({
    live,
    hostname: live ? cfg.hostname : null,
    userEmail: cfg.userEmail,
    ontology: cfg.ontology,
  })
}
