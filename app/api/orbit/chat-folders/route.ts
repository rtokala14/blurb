import { getObject } from "@/lib/foundry/client"
import {
  createChatFolder,
  foundryUserEmail,
  listChatFolders,
  serializeChatFolder,
  type ChatFolderRow,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"

/** Private chat folders (PoC GET/POST /api/chat-folders). */
export async function GET() {
  const guard = requireLive()
  if (guard) return guard
  try {
    const folders = await listChatFolders(foundryUserEmail())
    return json({ data: folders.map(serializeChatFolder), count: folders.length })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const body = (await request.json()) as { name?: string; color?: string }
    const name = (body.name ?? "").trim()
    if (!name) return json({ error: "Folder name is required" }, { status: 422 })
    const folderId = await createChatFolder({
      name,
      color: body.color,
      createdBy: foundryUserEmail(),
    })
    const created = await getObject<ChatFolderRow>("OrbitChatFolders", folderId)
    return json(
      created ? serializeChatFolder(created) : { primaryKey: folderId },
      { status: 201 }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
