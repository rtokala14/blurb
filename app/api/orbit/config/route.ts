import { NextResponse } from "next/server"

import { getFoundryConfig, isFoundryConfigured } from "@/lib/foundry/config"
import { getFoundryToken } from "@/lib/foundry/token"
import { getAccessibleFolders } from "@/lib/foundry/ontology"
import {
  getProvisionedUser,
  isAdminUser,
  resolveRequestUser,
  UserResolutionError,
} from "@/lib/foundry/user"
import { errorResponse } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

/** Mode probe: the client treats `live: false` as a hard "Foundry unavailable" error. */
export async function GET(request: Request) {
  const live = isFoundryConfigured()
  const cfg = getFoundryConfig()
  let userEmail = cfg.userEmail
  let isAdmin = false
  let isOnboarded = false
  let isAllowedToUpload = false
  if (live) {
    try {
      userEmail = await resolveRequestUser(request)
      const user = await getProvisionedUser(userEmail)
      isAdmin = isAdminUser(user)
      isOnboarded = user?.isOnboarded === true
      isAllowedToUpload = isAdmin || user?.isAllowedToUpload === true
    } catch (error) {
      if (error instanceof UserResolutionError) return errorResponse(error)
      // resolution hiccups (Foundry blip) shouldn't block the mode probe
    }
    // The client always calls /bootstrap right after this probe — start the
    // OAuth token fetch and the folder scan now so they overlap the round
    // trip instead of sitting on bootstrap's critical path.
    const warmEmail = userEmail
    void getFoundryToken()
      .then(() => getAccessibleFolders(warmEmail))
      .catch(() => undefined)
  }
  return NextResponse.json({
    live,
    hostname: live ? cfg.hostname : null,
    userEmail,
    ontology: cfg.ontology,
    isAdmin,
    isOnboarded,
    isAllowedToUpload,
  })
}
