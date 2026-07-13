import { BUILTIN_PERSONAS } from "@/lib/personas"
import { json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

/**
 * Persona catalog. v1 returns the built-in registry; custom (OrbitPersona)
 * personas fold in here in Tier 2. Kept server-side so the client stays in
 * sync with the registry version the server injects from.
 */
export async function GET() {
  const guard = requireLive()
  if (guard) return guard
  return json({ data: BUILTIN_PERSONAS })
}
