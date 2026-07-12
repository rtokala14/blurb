import {
  listSyncSources,
  serializeSyncSource,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const sources = await listSyncSources(await resolveRequestUser(request))
    return json({ data: sources.map(serializeSyncSource), count: sources.length })
  } catch (error) {
    return errorResponse(error)
  }
}
