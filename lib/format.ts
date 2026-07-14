export function formatSize(sizeKB: number): string {
  if (sizeKB >= 1024) return `${(sizeKB / 1024).toFixed(1)} MB`
  return `${Math.round(sizeKB)} KB`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(iso)
}

/**
 * Flatten markdown into clean plain text suitable for a `mailto:` body
 * (Outlook/native mail clients render mailto bodies as plain text). Strips
 * decorations while preserving list/heading readability.
 */
export function markdownToPlainText(md: string): string {
  return (
    md
      // fenced code blocks → keep inner text
      .replace(/```[\w-]*\n?([\s\S]*?)```/g, "$1")
      // inline code
      .replace(/`([^`]+)`/g, "$1")
      // images → alt text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // links → "text (url)"
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      // headings → plain line
      .replace(/^#{1,6}\s+/gm, "")
      // bold / italic markers
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      // blockquote markers
      .replace(/^>\s?/gm, "")
      // unordered bullets → "• "
      .replace(/^[-*+]\s+/gm, "• ")
      // collapse 3+ blank lines
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  )
}

/**
 * Build a `mailto:` URL that opens the default mail client (Outlook desktop,
 * Outlook web handler, Apple Mail, etc.) with the compose window prefilled.
 * All fields are RFC-2368 percent-encoded.
 */
export function buildMailto(fields: {
  to?: string
  cc?: string
  bcc?: string
  subject?: string
  body?: string
}): string {
  const to = (fields.to ?? "").trim()
  const params = new URLSearchParams()
  if (fields.cc?.trim()) params.set("cc", fields.cc.trim())
  if (fields.bcc?.trim()) params.set("bcc", fields.bcc.trim())
  if (fields.subject) params.set("subject", fields.subject)
  if (fields.body) params.set("body", fields.body)
  // URLSearchParams uses "+" for spaces; mail clients want %20.
  const query = params.toString().replace(/\+/g, "%20")
  return `mailto:${encodeURIComponent(to)}${query ? `?${query}` : ""}`
}
