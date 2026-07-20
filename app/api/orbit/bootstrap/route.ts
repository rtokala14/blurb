import {
  getIndexCountsForDocs,
  getAccessibleFolders,
  listAccessibleDocs,
  listSessions,
  pk,
  serializeDoc,
  serializeFolder,
  serializeSession,
} from "@/lib/foundry/ontology"
import {
  getProvisionedUser,
  listChatFolders,
  resolveRequestUser,
  serializeChatFolder,
} from "@/lib/foundry/user"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

/**
 * Single round-trip client bootstrap: documents, folders, sessions, and
 * chat folders together (avoids a waterfall on first paint). v3 has no
 * sync sources, so that list is always empty.
 */
export async function GET(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const userEmail = await resolveRequestUser(request)
    const [docsResult, folders, sessions, userRow] = await Promise.all([
      listAccessibleDocs(userEmail),
      getAccessibleFolders(userEmail),
      listSessions(userEmail),
      getProvisionedUser(userEmail),
    ])
    const indexCounts = await getIndexCountsForDocs(docsResult.docs)
    return json({
      userEmail,
      documents: docsResult.docs.map((doc) =>
        serializeDoc(doc, {
          indexCounts: indexCounts.get(pk(doc)),
          userEmail,
        })
      ),
      folders: [...folders]
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
        .map(serializeFolder),
      sessions: sessions.map((s) => serializeSession(s)),
      syncSources: [],
      chatFolders: (userRow ? listChatFolders(userRow) : []).map(
        serializeChatFolder
      ),
    })
  } catch (error) {
    return errorResponse(error)
  }
}
