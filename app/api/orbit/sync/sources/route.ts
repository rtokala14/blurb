import { json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

/**
 * Sync sources do not exist in the v3 pipeline. The route is kept so the
 * client's request still resolves; the UI hides the section when empty.
 */
export async function GET() {
  const guard = requireLive()
  if (guard) return guard
  return json({ data: [], count: 0 })
}
