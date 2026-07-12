import {
  foundryUserEmail,
  listAccessibleDocs,
  serializeDoc,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

export async function GET() {
  const guard = requireLive()
  if (guard) return guard
  try {
    const userEmail = foundryUserEmail()
    const result = await listAccessibleDocs(userEmail)
    return json({
      data: result.docs.map((doc) =>
        serializeDoc(doc, {
          sharedFolderNames: result.sharedFolderNames,
          indexStatus: result.indexStatus,
          userEmail,
        })
      ),
      count: result.docs.length,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
