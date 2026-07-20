import { PDFDocument } from "pdf-lib"

import { extractMediaItemRid, uploadMedia } from "@/lib/foundry/client"
import {
  createDocRow,
  normalizeEmail,
  searchAccessibleDocs,
} from "@/lib/foundry/ontology"
import { errorResponse, json, requireLive } from "@/lib/foundry/http"
import { getProvisionedUser, resolveRequestUser } from "@/lib/foundry/user"
import {
  commitUploadUsage,
  releaseUploadCapacity,
  reserveUploadCapacity,
} from "@/lib/foundry/quota"

export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * PDF upload pipeline: reserve quota → duplicate-name check → media upload →
 * create-doc-meta action. Foundry indexes asynchronously; the client polls
 * /docs/status. Page count is computed with pdf-lib for the response payload
 * only (noPages is not stored in v3).
 *
 * Office formats aren't converted here (no LibreOffice dependency); non-PDFs
 * get a clear 415 asking for PDF.
 */
export async function POST(request: Request) {
  const guard = requireLive()
  if (guard) return guard
  try {
    const email = normalizeEmail(await resolveRequestUser(request))
    const form = await request.formData()
    const files = form.getAll("files").filter((f): f is File => f instanceof File)
    const names = form.getAll("names").map(String)
    const folderField = form.get("folderId")
    const folderId = folderField ? String(folderField).trim() || null : null
    if (files.length === 0) {
      return json({ error: "No files provided" }, { status: 400 })
    }

    for (const file of files) {
      const isPdf =
        file.type === "application/pdf" || /\.pdf$/i.test(file.name ?? "")
      if (!isPdf) {
        return json(
          {
            error: `"${file.name}" is not a PDF. Convert Office documents to PDF before uploading.`,
          },
          { status: 415 }
        )
      }
    }

    const requestedNames = files.map((file, i) => (names[i] || file.name).trim())

    // Reserve batch capacity before any uploads so concurrent requests can't
    // blow past the daily limit. UploadNotAllowed/UploadQuotaExceeded surface
    // via errorResponse (403/429).
    const reservationId = crypto.randomUUID()
    const userRow = await getProvisionedUser(email)
    if (userRow) {
      await reserveUploadCapacity(userRow, files.length, reservationId)
    }

    try {
      // Duplicate-name check: exact fileName match among accessible docs.
      const dupResults = await Promise.all(
        requestedNames.map((name) => searchAccessibleDocs(email, name))
      )
      const duplicates = requestedNames.filter((name, i) =>
        dupResults[i].some(
          (doc) =>
            (doc.fileName ?? "").trim().toLowerCase() === name.toLowerCase()
        )
      )
      if (duplicates.length > 0) {
        releaseUploadCapacity(reservationId)
        return json(
          { error: "Duplicate document names", duplicates },
          { status: 409 }
        )
      }

      // Each file is processed independently (read → parse → upload → row), so
      // fan the batch out concurrently.
      const uploaded: {
        primaryKey: string
        documentName: string
        noPages: number
      }[] = []
      await Promise.all(
        files.map(async (file, i) => {
          const documentName = requestedNames[i]
          const bytes = await file.arrayBuffer()
          const pdf = await PDFDocument.load(bytes, {
            ignoreEncryption: true,
            updateMetadata: false,
          })
          const noPages = pdf.getPageCount()
          const reference = await uploadMedia(bytes, documentName)
          const primaryKey = await createDocRow({
            fileName: documentName,
            mime: "application/pdf",
            mediaPath: `${crypto.randomUUID()}-${documentName}`,
            mediaItemRid: extractMediaItemRid(reference) ?? "",
            mediaReference: reference,
            parentFolderId: folderId,
            userEmail: email,
          })
          uploaded.push({ primaryKey, documentName, noPages })
        })
      )
      commitUploadUsage(reservationId)
      return json({ success: true, uploaded })
    } catch (error) {
      releaseUploadCapacity(reservationId)
      throw error
    }
  } catch (error) {
    return errorResponse(error)
  }
}
