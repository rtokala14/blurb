import {
  createFolder,
  getAccessibleFolders,
  serializeFolder,
} from "@/lib/foundry/ontology"
import { getObject } from "@/lib/foundry/client"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import type { FolderRow } from "@/lib/foundry/ontology"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const folders = await getAccessibleFolders(await resolveRequestUser(request))
    const visible = folders.filter((f) => !f.isSyncManaged)
    visible.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
    return json({ data: visible.map(serializeFolder), count: visible.length })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const body = (await request.json()) as {
      name?: string
      color?: string
      accessEmails?: string[]
      contents?: string[]
    }
    const name = (body.name ?? "").trim()
    if (!name) return json({ error: "Folder name is required" }, { status: 422 })
    const folderId = await createFolder({
      name,
      createdBy: await resolveRequestUser(request),
      color: body.color,
      accessEmails: body.accessEmails,
      contents: body.contents,
    })
    const created = await getObject<FolderRow>("OrbitFolders", folderId)
    return json(created ? serializeFolder(created) : { primaryKey: folderId }, {
      status: 201,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
