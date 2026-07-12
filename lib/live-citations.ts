/**
 * Parses the agent's inline citation tags into the UI's marker format.
 *
 * The Foundry agent emits citations as:
 *   <source id="ri.mio.main.media-item.xxx" name="Document Title" text="quote">12</source>
 * where the inner text is a page ("12"), range ("2-3"), or list ("1, 4, 9").
 *
 * The UI renders citations as numbered chips via ⟦n⟧ markers, so this module
 * converts tags → markers plus a citations array carrying the media RID.
 * Pure functions — unit-tested.
 */

export interface LiveCitation {
  n: number
  mediaRid: string
  docName: string
  /** raw pages string, e.g. "642, 708, 871" */
  pages: string
  firstPage: number
  quote?: string
}

export interface ParsedLiveMessage {
  /** content with <source> tags replaced by ⟦n⟧ markers */
  content: string
  citations: LiveCitation[]
}

const SOURCE_TAG_RE = /<source\b([^>]*)>([\s\S]*?)<\/source>/gi
const ATTR_RE = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g

export function parseFirstPage(raw: string): number {
  const match = raw.trim().match(/^(\d+)/)
  return match ? Number(match[1]) : 0
}

export function formatPages(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ""
  const multiple = trimmed.includes(",") || trimmed.includes("-")
  return `${multiple ? "pp." : "p."} ${trimmed}`
}

function parseAttrs(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of attrText.matchAll(ATTR_RE)) {
    attrs[match[1].toLowerCase()] = match[2]
  }
  return attrs
}

/**
 * Convert a complete live message into marker-ized content + citations.
 * Identical (mediaRid, pages) pairs are deduplicated to one number.
 */
export function parseLiveMessage(raw: string): ParsedLiveMessage {
  const citations: LiveCitation[] = []
  const seen = new Map<string, number>()

  const content = raw
    .replace(SOURCE_TAG_RE, (_full, attrText: string, pagesText: string) => {
      const attrs = parseAttrs(attrText)
      const mediaRid = (attrs.id ?? "").trim()
      if (!mediaRid) return ""
      const pages = pagesText.trim() || "0"
      const key = `${mediaRid}#${pages}`
      let n = seen.get(key)
      if (n === undefined) {
        n = citations.length + 1
        seen.set(key, n)
        citations.push({
          n,
          mediaRid,
          docName: attrs.name?.trim() || "Source document",
          pages,
          firstPage: parseFirstPage(pages),
          quote: attrs.text?.trim() || undefined,
        })
      }
      return `⟦${n}⟧`
    })
    .replace(/[ \t]{2,}/g, " ")

  return { content, citations }
}

/**
 * Streaming-safe view: marker-izes complete tags and hides any trailing
 * partial `<source …` fragment so tags never flash as raw text mid-stream.
 */
export function parseStreamingLiveText(raw: string): ParsedLiveMessage {
  // Cut at the last possibly-incomplete tag opening that has no closing tag.
  const lastOpen = raw.lastIndexOf("<source")
  let safe = raw
  if (lastOpen !== -1 && !raw.slice(lastOpen).includes("</source>")) {
    safe = raw.slice(0, lastOpen)
  } else {
    // Also hide a bare partial "<sourc" prefix at the very end.
    const partial = raw.match(/<(?:s(?:o(?:u(?:r(?:c(?:e)?)?)?)?)?)?$/)
    if (partial && partial.index !== undefined) safe = raw.slice(0, partial.index)
  }
  // Trim whitespace only when we actually truncated a partial tag, so the
  // visible text doesn't end with a dangling space while the tag streams in.
  if (safe.length !== raw.length) safe = safe.replace(/\s+$/, "")
  return parseLiveMessage(safe)
}

/** Strip citation tags entirely (for exports/copy of live content). */
export function stripSourceTags(content: string): string {
  return content
    .replace(/<source[^>]*>[\s\S]*?<\/source>/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:])/g, "$1")
    .trim()
}
