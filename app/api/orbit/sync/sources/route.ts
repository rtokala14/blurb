import {
  foundryUserEmail,
  listSyncSources,
  serializeSyncSource,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

export async function GET() {
  const guard = requireLive()
  if (guard) return guard
  try {
    const sources = await listSyncSources(foundryUserEmail())
    return json({ data: sources.map(serializeSyncSource), count: sources.length })
  } catch (error) {
    return errorResponse(error)
  }
}
