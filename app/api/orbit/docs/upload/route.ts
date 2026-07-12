import { PDFDocument } from "pdf-lib"

import { uploadMedia } from "@/lib/foundry/client"
import {
  createDocRow,
  foundryUserEmail,
  normalizeEmail,
  type DocRow,
} from "@/lib/foundry/ontology"
import { searchObjects } from "@/lib/foundry/client"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"

export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * PDF upload pipeline (PoC POST /api/docs/upload):
 * duplicate-name check → media set upload → create-orbit-docs-list action.
 * Foundry pipelines index asynchronously; the client polls /docs/status.
 *
 * Office formats (.docx/.pptx/.xlsx) are converted with LibreOffice in the
 * PoC backend; that dependency isn't available here, so non-PDFs get a clear
 * 415 asking for PDF. Page count is computed server-side with pdf-lib
 * (client hints ignored, matching the PoC).
 */
export async function POST(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const userEmail = foundryUserEmail()
    const form = await request.formData()
    const files = form.getAll("files").filter((f): f is File => f instanceof File)
    const names = form.getAll("names").map(String)
    if (files.length === 0) {
      return json({ error: "No files provided" }, { status: 400 })
    }

    for (const file of files) {
      const isPdf =
        file.type === "application/pdf" || /\.pdf$/i.test(file.name ?? "")
      if (!isPdf) {
        return json(
          {
            error: `"${file.name}" is not a PDF. Convert Office documents to PDF before uploading (the PoC's LibreOffice conversion service is not bundled here).`,
          },
          { status: 415 }
        )
      }
    }

    // Duplicate-name check against the user's active documents.
    const existing = await searchObjects<DocRow>("OrbitDocsList", {
      where: {
        type: "and",
        value: [
          { type: "eq", field: "addedBy", value: normalizeEmail(userEmail) },
          { type: "eq", field: "isActive", value: true },
        ],
      },
      select: ["documentName", "primaryKey_"],
    })
    const existingNames = new Set(
      existing.map((d) => (d.documentName ?? "").trim().toLowerCase())
    )
    const duplicates = files
      .map((file, i) => (names[i] || file.name).trim())
      .filter((name) => existingNames.has(name.toLowerCase()))
    if (duplicates.length > 0) {
      return json(
        { error: "Duplicate document names", duplicates },
        { status: 409 }
      )
    }

    const uploaded: { documentName: string; noPages: number }[] = []
    for (const [i, file] of files.entries()) {
      const documentName = (names[i] || file.name).trim()
      const bytes = await file.arrayBuffer()
      const pdf = await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      })
      const noPages = pdf.getPageCount()

      const safeStem = documentName
        .replace(/\.pdf$/i, "")
        .replace(/[^a-zA-Z0-9-_]+/g, "-")
        .slice(0, 60)
      const mediaItemPath = `uploads/${crypto.randomUUID().slice(0, 12)}_${safeStem}.pdf`
      const reference = await uploadMedia(bytes, mediaItemPath)

      await createDocRow({
        documentName,
        reference,
        noPages,
        addedBy: userEmail,
      })
      uploaded.push({ documentName, noPages })
    }

    return json({ success: true, uploaded })
  } catch (error) {
    return errorResponse(error)
  }
}
