import { NextResponse } from "next/server"

import { getFoundryConfig, isFoundryConfigured } from "@/lib/foundry/config"
import { getFoundryToken } from "@/lib/foundry/token"
import { getAccessibleFolders } from "@/lib/foundry/ontology"

export const dynamic = "force-dynamic"

/** Mode probe: the client decides between demo simulation and live Foundry. */
export async function GET() {
  const live = isFoundryConfigured()
  const cfg = getFoundryConfig()
  if (live) {
    // The client always calls /bootstrap right after this probe — start the
    // OAuth token fetch and the folder scan now so they overlap the round
    // trip instead of sitting on bootstrap's critical path.
    void getFoundryToken()
      .then(() => getAccessibleFolders(cfg.userEmail))
      .catch(() => undefined)
  }
  return NextResponse.json({
    live,
    hostname: live ? cfg.hostname : null,
    userEmail: cfg.userEmail,
    ontology: cfg.ontology,
  })
}
