"use client"

/**
 * Live artifact lifecycle. Generated documents live inside the session
 * transcript (the persisted assistant message IS the envelope), so artifacts
 * are re-derived from messages on every transcript load — drafts survive
 * reloads and devices for free. Local edits (accepted AI edits, manual
 * fixes) are layered on top from localStorage, keyed by the deterministic
 * artifact id, until a future OrbitArtifact ontology object exists (Tier 2).
 */

import type { Artifact, ChatMessage } from "@/lib/types"
import type { DocModel, DocVersionEntry } from "./model"
import { parseDocEnvelope, parseDocFromMarked } from "./parse"
import { getDocSkill } from "./skills"

const DRAFT_STORE_KEY = "orbit.doc-drafts.v1"
const MAX_DRAFTS = 40
export const MAX_VERSIONS = 20

interface StoredDraft {
  /** serialized envelope markdown of the CURRENT (edited) model */
  markdown: string
  versions: DocVersionEntry[]
  updatedAt: string
}

function readDrafts(): Record<string, StoredDraft> {
  if (typeof window === "undefined") return {}
  try {
    return JSON.parse(window.localStorage.getItem(DRAFT_STORE_KEY) || "{}")
  } catch {
    return {}
  }
}

export function persistDocDraft(
  artifactId: string,
  markdown: string,
  versions: DocVersionEntry[]
): void {
  if (typeof window === "undefined") return
  const drafts = readDrafts()
  drafts[artifactId] = {
    markdown,
    versions: versions.slice(-MAX_VERSIONS),
    updatedAt: new Date().toISOString(),
  }
  // evict oldest beyond the cap
  const keys = Object.keys(drafts)
  if (keys.length > MAX_DRAFTS) {
    keys
      .sort((a, b) => drafts[a].updatedAt.localeCompare(drafts[b].updatedAt))
      .slice(0, keys.length - MAX_DRAFTS)
      .forEach((k) => delete drafts[k])
  }
  try {
    window.localStorage.setItem(DRAFT_STORE_KEY, JSON.stringify(drafts))
  } catch {
    /* storage full/blocked — edits still live in memory this session */
  }
}

export function clearDocDraft(artifactId: string): void {
  if (typeof window === "undefined") return
  const drafts = readDrafts()
  if (!(artifactId in drafts)) return
  delete drafts[artifactId]
  try {
    window.localStorage.setItem(DRAFT_STORE_KEY, JSON.stringify(drafts))
  } catch {
    /* ignore */
  }
}

export function readDocDraft(artifactId: string): StoredDraft | null {
  return readDrafts()[artifactId] ?? null
}

/** Deterministic artifact id for a persisted assistant message. */
export function artifactIdForMessage(messageId: string): string {
  return `art-${messageId}`
}

export function isDocEnvelopeContent(content: string): boolean {
  return content.includes("```orbit-doc")
}

/** One-line stand-in shown in the chat transcript instead of the raw envelope. */
export function chatLineForDoc(model: DocModel): string {
  return `Drafted **${model.meta.title}** — open it in the Studio panel to review, edit, and export.`
}

/**
 * Scan a mapped transcript for generated documents: envelope-bearing
 * assistant messages become artifacts (with any local edits layered on),
 * and their chat content collapses to a one-line summary + artifact card.
 * Pure over its inputs apart from the localStorage read.
 */
export function deriveDocArtifacts(
  sessionId: string,
  messages: Record<string, ChatMessage>
): { messages: Record<string, ChatMessage>; artifacts: Artifact[] } {
  const artifacts: Artifact[] = []
  let patched: Record<string, ChatMessage> | null = null

  for (const [id, message] of Object.entries(messages)) {
    if (message.role !== "assistant" || !isDocEnvelopeContent(message.content)) {
      continue
    }
    const artifactId = artifactIdForMessage(id)
    const original = parseDocFromMarked(message.content, message.citations ?? [])
    const draft = readDocDraft(artifactId)
    let model = original
    let versions: DocVersionEntry[] = draft?.versions ?? []
    if (draft) {
      const edited = parseDocEnvelope(draft.markdown)
      // guard against a corrupt stored draft wiping a good document
      if (edited.blocks.length > 0) model = edited
      else versions = []
    }
    artifacts.push({
      id: artifactId,
      kind: "doc",
      title: model.meta.title,
      status: "ready",
      createdAt: message.createdAt,
      updatedAt: draft?.updatedAt ?? message.createdAt,
      sourceDocIds: [],
      sessionId,
      docSkillId: getDocSkill(model.meta.docType)?.id,
      model,
      versions,
      live: true,
      lastEditSummary: versions.length
        ? versions[versions.length - 1].summary
        : undefined,
    })
    patched ??= { ...messages }
    patched[id] = {
      ...message,
      content: chatLineForDoc(model),
      citations: [],
      artifactIds: [artifactId],
    }
  }

  return { messages: patched ?? messages, artifacts }
}

/** Safe file name for exports: "Title — Rev A.docx". */
export function docFileName(model: DocModel, ext: string): string {
  const base = `${model.meta.title} — ${model.meta.revision}`
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
  return `${base}.${ext}`
}
