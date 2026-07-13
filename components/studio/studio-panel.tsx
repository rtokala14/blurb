"use client"

import * as React from "react"
import { ArrowUp, FileDown, History, UploadCloud, X } from "lucide-react"
import { toast } from "sonner"

import { artifactMeta } from "@/components/chat/artifact-card"
import { DocIcon } from "@/components/doc-icon"
import { DeckEditor } from "@/components/studio/deck-editor"
import { DocEditor } from "@/components/studio/doc-editor"
import { LiveDocEditor } from "@/components/studio/live-doc-editor"
import { SheetEditor } from "@/components/studio/sheet-editor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { docFileName, persistDocDraft } from "@/lib/docgen/artifacts"
import { parseDocEnvelope, serializeDocModel } from "@/lib/docgen/parse"
import { renderDocx } from "@/lib/docgen/render-docx"
import { renderPdf } from "@/lib/docgen/render-pdf"
import { downloadBlob } from "@/lib/export-session"
import { liveApi } from "@/lib/live-api"
import { mapLiveDoc } from "@/lib/live-map"
import { cn } from "@/lib/utils"
import { useOrbit } from "@/lib/store"
import type { Artifact } from "@/lib/types"

/**
 * The Studio: where AI-created documents, spreadsheets, and decks are
 * reviewed and edited. Rendered as a side panel in Chat and full-page
 * on /studio. Live artifacts (generated on Foundry) get the real editor,
 * exports, and save-to-library; demo artifacts keep the simulation.
 */
export function StudioPanel({
  artifact,
  onClose,
  standalone = false,
}: {
  artifact: Artifact
  onClose?: () => void
  standalone?: boolean
}) {
  const docs = useOrbit((s) => s.docs)
  const updateArtifact = useOrbit((s) => s.updateArtifact)
  const pushActivity = useOrbit((s) => s.pushActivity)
  const [editValue, setEditValue] = React.useState("")
  const [editRequest, setEditRequest] = React.useState<{
    id: number
    text: string
  } | null>(null)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const meta = artifactMeta[artifact.kind]
  const generating = artifact.status === "generating"
  const isLive = artifact.live === true
  const model = artifact.model

  const sources = artifact.sourceDocIds
    .map((id) => docs.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => !!d)
  /** live artifacts ground in whatever the draft actually cites */
  const citedNames = [
    ...new Set((model?.citations ?? []).map((c) => c.docName || "Source document")),
  ]

  const requestEdit = () => {
    const text = editValue.trim()
    if (!text || editing) return
    setEditing(true)
    setEditRequest({ id: (editRequest?.id ?? 0) + 1, text })
    setEditValue("")
  }

  /**
   * Demo editors report an applied edit (summary). The live editor reports
   * null when the refine response lands — accept/reject and persistence
   * happen inside it.
   */
  const handleEditDone = React.useCallback(
    (summary: string | null) => {
      setEditing(false)
      setEditRequest(null)
      if (summary === null) return
      updateArtifact(artifact.id, {
        lastEditSummary: summary,
        updatedAt: new Date().toISOString(),
      })
      toast.success("AI edit applied", { description: summary })
    },
    [artifact.id, updateArtifact]
  )

  /* ---------------- live actions ---------------- */

  const exportAs = async (format: "docx" | "pdf" | "md") => {
    if (!model) return
    try {
      if (format === "docx") {
        downloadBlob(await renderDocx(model), docFileName(model, "docx"))
      } else if (format === "pdf") {
        downloadBlob(renderPdf(model), docFileName(model, "pdf"))
      } else {
        downloadBlob(
          new Blob([serializeDocModel(model)], { type: "text/markdown" }),
          docFileName(model, "md")
        )
      }
    } catch (error) {
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  const saveToLibrary = async () => {
    if (!model || saving) return
    setSaving(true)
    try {
      const blob = await renderDocx(model)
      const name = docFileName(model, "docx")
      const file = new File([blob], name, {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
      await liveApi.uploadDocs([{ file, name }])
      pushActivity({
        kind: "upload",
        text: `Saved “${model.meta.title}” to the Library`,
        detail: "Indexing in progress",
      })
      toast.success("Saved to your Library", {
        description:
          "Foundry is indexing it now — it can ground future sessions like any other document.",
      })
      // refresh the docs list so the new row appears immediately
      const { data } = await liveApi.docs()
      const mapped = data.map((d) => mapLiveDoc(d, new Map()))
      useOrbit.setState((prev) => ({
        docs: mapped.map((doc) => {
          const existing = prev.docs.find((d) => d.id === doc.id)
          return existing ? { ...doc, folderId: existing.folderId } : doc
        }),
      }))
    } catch (error) {
      toast.error("Couldn't save to the Library", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const restoreVersion = (v: number) => {
    const entry = artifact.versions?.find((x) => x.v === v)
    if (!entry) return
    const restored = parseDocEnvelope(entry.markdown)
    if (restored.blocks.length === 0) {
      toast.error("Couldn't restore that version")
      return
    }
    const versions = [
      ...(artifact.versions ?? []),
      {
        v: (artifact.versions?.[artifact.versions.length - 1]?.v ?? 1) + 1,
        summary: `Restored v${v}`,
        at: new Date().toISOString(),
        markdown: entry.markdown,
      },
    ]
    persistDocDraft(artifact.id, entry.markdown, versions)
    updateArtifact(artifact.id, {
      model: restored,
      versions,
      title: restored.meta.title,
      lastEditSummary: `Restored v${v}`,
      updatedAt: new Date().toISOString(),
    })
    toast.success(`Restored v${v}`)
  }

  const Editor = isLive
    ? LiveDocEditor
    : artifact.kind === "doc"
      ? DocEditor
      : artifact.kind === "sheet"
        ? SheetEditor
        : DeckEditor

  return (
    <div className={cn("bg-background flex h-full min-h-0 flex-col", !standalone && "border-l")}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <meta.icon className={cn("size-4 shrink-0", meta.className)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{artifact.title}</p>
          <p className="text-muted-foreground truncate text-[11px]">
            {generating ? (
              <span className="thinking-shimmer">AI is generating…</span>
            ) : (
              (artifact.lastEditSummary ??
                (isLive && model
                  ? `${meta.label} · ${model.meta.revision} · grounded in ${citedNames.length || "your"} ${citedNames.length === 1 ? "source" : "sources"}`
                  : `${meta.label} · ready`))
            )}
          </p>
        </div>
        <Badge variant={generating ? "outline" : "secondary"} className="shrink-0">
          {generating ? (
            <>
              <Spinner className="size-3" /> Drafting
            </>
          ) : isLive && model ? (
            model.meta.revision
          ) : (
            "Draft"
          )}
        </Badge>

        {isLive && model && !generating && (
          <>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Export document">
                      <FileDown />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Export (Jacobs-branded)</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Export</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => void exportAs("docx")}>
                  Word (.docx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void exportAs("pdf")}>
                  PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void exportAs("md")}>
                  Markdown
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Save to Library"
                  disabled={saving}
                  onClick={() => void saveToLibrary()}
                >
                  {saving ? <Spinner className="size-3.5" /> : <UploadCloud />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Save to Library — becomes a real, indexed document
              </TooltipContent>
            </Tooltip>
          </>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Version history & sources"
            >
              <History />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Grounded in</DropdownMenuLabel>
            {isLive
              ? citedNames.length > 0
                ? citedNames.slice(0, 8).map((name) => (
                    <DropdownMenuItem key={name}>
                      <DocIcon type="pdf" />
                      <span className="truncate">{name}</span>
                    </DropdownMenuItem>
                  ))
                : sources.map((doc) => (
                    <DropdownMenuItem key={doc.id}>
                      <DocIcon type={doc.type} />
                      <span className="truncate">{doc.name}</span>
                    </DropdownMenuItem>
                  ))
              : sources.map((doc) => (
                  <DropdownMenuItem key={doc.id}>
                    <DocIcon type={doc.type} />
                    <span className="truncate">{doc.name}</span>
                  </DropdownMenuItem>
                ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Versions</DropdownMenuLabel>
            {isLive ? (
              artifact.versions && artifact.versions.length > 0 ? (
                [...artifact.versions].reverse().map((entry, i) => (
                  <DropdownMenuItem
                    key={entry.v}
                    onClick={() => i !== 0 && restoreVersion(entry.v)}
                  >
                    <span className="truncate">
                      v{entry.v} — {entry.summary}
                    </span>
                    {i === 0 && (
                      <span className="text-muted-foreground ml-auto text-xs">
                        current
                      </span>
                    )}
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem>v1 — initial AI draft</DropdownMenuItem>
              )
            ) : (
              <>
                <DropdownMenuItem>
                  v2 — current {artifact.lastEditSummary ? `· ${artifact.lastEditSummary}` : ""}
                </DropdownMenuItem>
                <DropdownMenuItem>v1 — initial AI draft</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {onClose && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close Studio panel"
                onClick={onClose}
              >
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close Studio</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Editor */}
      <div className="min-h-0 flex-1">
        <Editor
          artifact={artifact}
          editRequest={editRequest}
          onEditDone={handleEditDone}
        />
      </div>

      {/* AI edit bar */}
      <div className="border-t p-2.5">
        <div className="relative">
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && requestEdit()}
            disabled={generating || editing}
            placeholder={
              editing
                ? "AI is editing…"
                : isLive
                  ? "Ask AI to edit — click a section first to scope it, or leave unselected for the whole document"
                  : artifact.kind === "sheet"
                    ? "Ask AI to edit — e.g. “add a −10% scenario column”"
                    : artifact.kind === "deck"
                      ? "Ask AI to edit — e.g. “sharpen this slide's bullets”"
                      : "Ask AI to edit — e.g. “add a benchmarking point to Leverage”"
            }
            className="h-9 pr-10"
          />
          <Button
            size="icon-sm"
            className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
            aria-label="Apply AI edit"
            disabled={!editValue.trim() || editing || generating}
            onClick={requestEdit}
          >
            {editing ? <Spinner className="size-3.5" /> : <ArrowUp />}
          </Button>
        </div>
        <p className="text-muted-foreground mt-1.5 text-center text-[10px]">
          {isLive
            ? "AI edits arrive as tracked changes — accept or reject before exporting"
            : `Edits are tracked — accept or reject AI changes in the ${meta.label.toLowerCase()}`}
        </p>
      </div>
    </div>
  )
}
