"use client"

import * as React from "react"
import { ArrowUp, History, X } from "lucide-react"
import { toast } from "sonner"

import { artifactMeta } from "@/components/chat/artifact-card"
import { DocIcon } from "@/components/doc-icon"
import { DeckEditor } from "@/components/studio/deck-editor"
import { DocEditor } from "@/components/studio/doc-editor"
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
import { cn } from "@/lib/utils"
import { useOrbit } from "@/lib/store"
import type { Artifact } from "@/lib/types"

/**
 * The Studio: where AI-created documents, spreadsheets, and decks are
 * reviewed and edited. Rendered as a side panel in Chat and full-page
 * on /studio.
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
  const [editValue, setEditValue] = React.useState("")
  const [editRequest, setEditRequest] = React.useState<{
    id: number
    text: string
  } | null>(null)
  const [editing, setEditing] = React.useState(false)

  const meta = artifactMeta[artifact.kind]
  const generating = artifact.status === "generating"
  const sources = artifact.sourceDocIds
    .map((id) => docs.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => !!d)

  const requestEdit = () => {
    const text = editValue.trim()
    if (!text || editing) return
    setEditing(true)
    setEditRequest({ id: (editRequest?.id ?? 0) + 1, text })
    setEditValue("")
  }

  const handleEditDone = React.useCallback(
    (summary: string) => {
      setEditing(false)
      setEditRequest(null)
      updateArtifact(artifact.id, {
        lastEditSummary: summary,
        updatedAt: new Date().toISOString(),
      })
      toast.success("AI edit applied", { description: summary })
    },
    [artifact.id, updateArtifact]
  )

  const Editor =
    artifact.kind === "doc"
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
              (artifact.lastEditSummary ?? `${meta.label} · ready`)
            )}
          </p>
        </div>
        <Badge variant={generating ? "outline" : "secondary"} className="shrink-0">
          {generating ? (
            <>
              <Spinner className="size-3" /> Drafting
            </>
          ) : (
            "Draft"
          )}
        </Badge>
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
            {sources.map((doc) => (
              <DropdownMenuItem key={doc.id}>
                <DocIcon type={doc.type} />
                <span className="truncate">{doc.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Versions</DropdownMenuLabel>
            <DropdownMenuItem>
              v2 — current {artifact.lastEditSummary ? `· ${artifact.lastEditSummary}` : ""}
            </DropdownMenuItem>
            <DropdownMenuItem>v1 — initial AI draft</DropdownMenuItem>
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
          Edits are tracked — accept or reject AI changes in the {meta.label.toLowerCase()}
        </p>
      </div>
    </div>
  )
}
