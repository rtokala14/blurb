import { NextResponse } from "next/server"

/**
 * Per-batch indexing notifications, delivered via SendGrid.
 *
 * Configuration (set in .env.local):
 *   SENDGRID_API_KEY    — SendGrid API key with mail-send scope
 *   SENDGRID_FROM_EMAIL — verified sender address (defaults below)
 *
 * Without a key the route responds with { simulated: true } so the UI
 * flow still completes — add the key and real email goes out, no code
 * changes needed.
 */

interface BatchFile {
  name: string
  pages?: number
}

export async function GET() {
  return NextResponse.json({
    provider: "sendgrid",
    configured: Boolean(process.env.SENDGRID_API_KEY),
  })
}

export async function POST(req: Request) {
  let body: { to?: string; folderName?: string; files?: BatchFile[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const to = body.to?.trim()
  const files = Array.isArray(body.files) ? body.files.slice(0, 100) : []
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || files.length === 0) {
    return NextResponse.json(
      { error: "Expected { to: email, files: [{ name }] }" },
      { status: 400 }
    )
  }

  const subject = `Indexing complete — ${files.length} ${
    files.length === 1 ? "document is" : "documents are"
  } ready to query`
  const fileRows = files
    .map(
      (f) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(
          f.name
        )}</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">${
          f.pages ? `${f.pages} pages` : ""
        }</td></tr>`
    )
    .join("")
  const html = `
    <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <p style="font-size:11px;letter-spacing:0.18em;color:#1d4ed8;font-weight:600;margin:0 0 4px;">JACOBS · ORBIT DOCS</p>
      <h2 style="margin:0 0 8px;color:#0f172a;">Your upload batch is indexed</h2>
      <p style="color:#475569;">All ${files.length} ${
        files.length === 1 ? "document" : "documents"
      }${body.folderName ? ` in <strong>${escapeHtml(body.folderName)}</strong>` : ""} finished OCR and indexing. They're now searchable in chat with full citations.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">${fileRows}</table>
      <p style="margin-top:16px;"><a href="https://orbit-docs.example.com/chat" style="color:#1d4ed8;">Ask a question about them →</a></p>
    </div>`

  const apiKey = process.env.SENDGRID_API_KEY
  const from = process.env.SENDGRID_FROM_EMAIL ?? "notifications@orbit-docs.example.com"

  if (!apiKey) {
    // No key yet — acknowledge so the product flow completes end to end.
    return NextResponse.json({ sent: false, simulated: true, to, subject })
  }

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: "Orbit Docs" },
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  })

  if (res.status === 202) {
    return NextResponse.json({ sent: true, to, subject })
  }
  const detail = await res.text().catch(() => "")
  return NextResponse.json(
    { sent: false, error: `SendGrid responded ${res.status}`, detail },
    { status: 502 }
  )
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
