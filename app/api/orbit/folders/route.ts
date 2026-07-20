import {
  createFolder,
  getAccessibleFolders,
  getFolder,
  serializeFolder,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { resolveRequestUser } from "@/lib/foundry/user"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const folders = await getAccessibleFolders(await resolveRequestUser(request))
    const sorted = [...folders].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "")
    )
    return json({ data: sorted.map(serializeFolder), count: sorted.length })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const userEmail = await resolveRequestUser(request)
    const body = (await request.json()) as {
      name?: string
      parentId?: string | null
      accessEmails?: string[]
    }
    const name = (body.name ?? "").trim()
    if (!name) return json({ error: "Folder name is required" }, { status: 422 })
    const folderId = await createFolder({
      name,
      parentFolderId: body.parentId ?? null,
      ownerUserId: userEmail,
      allowedUserIds: body.accessEmails,
    })
    const created = await getFolder(folderId)
    return json(created ? serializeFolder(created) : { primaryKey: folderId }, {
      status: 201,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
