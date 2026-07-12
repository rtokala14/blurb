import {
  foundryUserEmail,
  listAccessibleDocs,
  listSessions,
  listSyncSources,
  serializeDoc,
  serializeFolder,
  serializeSession,
  serializeSyncSource,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

/**
 * Single round-trip client bootstrap: documents, folders, sessions, and
 * sync sources together (avoids a 4-request waterfall on first paint).
 */
export async function GET() {
  const guard = requireLive()
  if (guard) return guard
  try {
    const userEmail = foundryUserEmail()
    const [docsResult, sessions, syncSources] = await Promise.all([
      listAccessibleDocs(userEmail),
      listSessions(userEmail),
      listSyncSources(userEmail).catch(() => []),
    ])
    return json({
      userEmail,
      documents: docsResult.docs.map((doc) =>
        serializeDoc(doc, {
          sharedFolderNames: docsResult.sharedFolderNames,
          indexStatus: docsResult.indexStatus,
          userEmail,
        })
      ),
      // Sync-managed folders stay in the access map (doc visibility) but are
      // hidden from the UI list — PoC /api/folders semantics. On the real
      // tenant this is the difference between ~40 and ~4,400 folders.
      folders: docsResult.folders
        .filter((f) => !f.isSyncManaged)
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
        .map(serializeFolder),
      sessions: sessions.map((s) => serializeSession(s)),
      syncSources: syncSources.map(serializeSyncSource),
    })
  } catch (error) {
    return errorResponse(error)
  }
}
