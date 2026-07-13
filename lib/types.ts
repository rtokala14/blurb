// type-only import — erased at runtime, so no module cycle with docgen/model
import type { DocModel, DocVersionEntry } from "@/lib/docgen/model"

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export type DocType = "pdf" | "docx" | "xlsx" | "pptx" | "csv" | "md"

export type DocSource = "upload" | "sharepoint" | "generated"

export type DocStatus =
  | "uploading"
  | "processing"
  | "indexing"
  | "ready"
  | "syncing"
  | "error"

export interface DocFolder {
  id: string
  name: string
  parentId: string | null
  source: DocSource
  sharePointPath?: string
}

export interface Doc {
  id: string
  name: string
  type: DocType
  folderId: string | null
  source: DocSource
  status: DocStatus
  sizeKB: number
  pages: number
  owner: string
  updatedAt: string
  tags: string[]
  summary: string
  version: number
  /** 0-100, only meaningful while uploading/processing */
  progress?: number
  /** live mode: media item RID for direct PDF preview */
  mediaRid?: string | null
}

export interface DocVersion {
  version: number
  date: string
  author: string
  note: string
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

export type ThinkingKind =
  | "plan"
  | "search"
  | "read"
  | "analyze"
  | "synthesize"
  | "tool"

export interface ThinkingStep {
  id: string
  kind: ThinkingKind
  label: string
  detail?: string
  /** doc ids consulted during this step */
  docIds?: string[]
}

export interface Citation {
  /** citation number as rendered inline, unique per message */
  n: number
  docId: string
  page: number
  quote: string
  /** live mode: media item RID behind the citation (ri.mio.…media-item.…) */
  mediaRid?: string
  /** live mode: display name from the source tag */
  docName?: string
  /** live mode: raw pages string, e.g. "642, 708, 871" */
  pagesLabel?: string
}

export type ArtifactKind = "doc" | "sheet" | "deck"

export type ArtifactStatus = "queued" | "generating" | "ready"

export interface Artifact {
  id: string
  kind: ArtifactKind
  title: string
  status: ArtifactStatus
  createdAt: string
  updatedAt: string
  /** ids of source documents the artifact was grounded in */
  sourceDocIds: string[]
  /** short description of the last AI edit applied */
  lastEditSummary?: string
  /** live mode: session this artifact belongs to */
  sessionId?: string
  /** live mode: skill pack that produced it */
  docSkillId?: string
  /** live mode: parsed document content (demo artifacts have none) */
  model?: DocModel
  /** live mode: accepted edit rounds, oldest first */
  versions?: DocVersionEntry[]
  /** live mode: derived from a real transcript (vs demo seed) */
  live?: boolean
}

export type MessageRole = "user" | "assistant"

export type MessagePhase = "thinking" | "streaming" | "done"

export interface ChatMessage {
  id: string
  parentId: string | null
  role: MessageRole
  /**
   * Markdown-ish body. Assistant messages may contain citation markers
   * like ⟦1⟧ which render as inline citation chips.
   */
  content: string
  createdAt: string
  phase: MessagePhase
  thinking?: ThinkingStep[]
  /** whether the thinking block is expanded in the UI */
  citations?: Citation[]
  artifactIds?: string[]
  /** for user messages: doc/folder scope snapshot label, e.g. "8 documents" */
  scopeLabel?: string
  /** marks the message as an edited variant (branch) */
  editedFrom?: string
  /** live mode: server-reported alternate branch count at this message */
  alternateBranchCount?: number | null
  /** live mode: stream error surfaced inline */
  errorType?: "context_exceeded" | "error"
}

export interface SessionBranchMeta {
  id: string
  name: string
  isDefault: boolean
  anchorMessageId: string | null
}

export interface ChatSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  /** id of the current leaf message — the active path is derived from it */
  leafId: string | null
  messages: Record<string, ChatMessage>
  /** ids of documents in scope for this session */
  scopeDocIds: string[]
  pinned?: boolean
  /** live mode: session exists on Foundry */
  live?: boolean
  /** live mode: whether the transcript has been fetched */
  contentLoaded?: boolean
  foldersAttached?: string[]
  branches?: SessionBranchMeta[]
  activeBranchId?: string | null
  runStatus?: string
  /** live mode: chat folder this session is filed in */
  chatFolderId?: string | null
  /** live mode: "regular" | "thinking" — the agent used for new turns */
  mode?: string
  /** built-in persona attached to this session (null = none) */
  personaId?: string | null
}

/** Private folder for organizing chat sessions (live mode). */
export interface ChatFolder {
  id: string
  name: string
  /** color token: slate | sky | indigo | teal | emerald | amber | rose */
  color: string | null
  updatedAt: string | null
}

/* ------------------------------------------------------------------ */
/* SharePoint                                                          */
/* ------------------------------------------------------------------ */

export type SyncState = "idle" | "syncing" | "attention"

export interface SharePointSite {
  id: string
  name: string
  url: string
  mappedFolderId: string
  lastSyncedAt: string
  docCount: number
  state: SyncState
  /** number of items needing review (conflicts, permission changes) */
  attentionCount: number
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export interface ActivityItem {
  id: string
  kind: "upload" | "sync" | "chat" | "artifact" | "share" | "export"
  text: string
  detail?: string
  time: string
}
