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
