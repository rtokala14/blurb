import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import {
  getProvisionedUser,
  listChatFolders,
  normalizeChatFolderColor,
  resolveRequestUser,
  saveChatFolders,
  serializeChatFolder,
  type ChatFolderPref,
} from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

/** Private chat folders (stored in the user's options JSON). */
export async function GET(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const userRow = await getProvisionedUser(await resolveRequestUser(request))
    const folders = userRow ? listChatFolders(userRow) : []
    return json({
      data: folders.map(serializeChatFolder),
      count: folders.length,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const userRow = await getProvisionedUser(await resolveRequestUser(request))
    if (!userRow) return json({ error: "User not found" }, { status: 404 })
    const body = (await request.json()) as { name?: string; color?: string }
    const name = (body.name ?? "").trim()
    if (!name) return json({ error: "Folder name is required" }, { status: 422 })
    const folder: ChatFolderPref = {
      id: crypto.randomUUID(),
      name,
      color: normalizeChatFolderColor(body.color),
    }
    await saveChatFolders(userRow, [...listChatFolders(userRow), folder])
    return json(serializeChatFolder(folder), { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
