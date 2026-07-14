"use client"

import * as React from "react"
import { Check, PencilLine, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CALLOUT_CLASSES, CALLOUT_TONES } from "@/lib/brand/jacobs"
import { MAX_VERSIONS, persistDocDraft } from "@/lib/docgen/artifacts"
import {
  citedNumbers,
  sectionBlockIds,
  type Block,
  type DocModel,
  type DocVersionEntry,
  type InlineRun,
} from "@/lib/docgen/model"
import {
  blocksToMarkdown,
  parseBlocks,
  parseFragment,
  serializeDocModel,
} from "@/lib/docgen/parse"
import { liveApi } from "@/lib/live-api"
import { useOrbit } from "@/lib/store"
import type { Artifact, Citation } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Live document editor: renders the DocModel with the same brand tokens the
 * exports use (screen ≈ print), and owns the three editing tiers —
 * manual block edits, refine-backed section edits shown as tracked changes,
 * and whole-document revisions. Accepted rounds append to the version list
 * and persist locally (drafts are per-browser until saved to the Library).
 */

interface PendingChange {
  targetIds: string[]
  newBlocks: Block[]
  citations: Citation[]
  summary: string
}

/** "Rev A" → "Rev B" (stops at Z). */
function bumpRevision(revision: string): string {
  const match = revision.match(/^Rev ([A-Y])$/)
  return match
    ? `Rev ${String.fromCharCode(match[1].charCodeAt(0) + 1)}`
    : revision
}

function InlineRuns({
  runs,
  citations,
}: {
  runs: InlineRun[]
  citations: Citation[]
}) {
  return (
    <>
      {runs.map((run, i) => {
        if (run.t === "cite") {
          const cite = citations.find((c) => c.n === run.n)
          if (!cite) return null
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <sup className="text-primary cursor-default text-[0.7em] font-medium">
                  [{run.n}]
                </sup>
              </TooltipTrigger>
              <TooltipContent>
                {cite.docName || "Source document"}
                {cite.pagesLabel ? ` — p. ${cite.pagesLabel}` : ""}
              </TooltipContent>
            </Tooltip>
          )
        }
        if (run.bold) return <strong key={i}>{run.text}</strong>
        if (run.italic) return <em key={i}>{run.text}</em>
        return <React.Fragment key={i}>{run.text}</React.Fragment>
      })}
    </>
  )
}

function BlockView({ block, citations }: { block: Block; citations: Citation[] }) {
  switch (block.kind) {
    case "heading": {
      const Tag = (`h${block.level + 1}` as "h2" | "h3" | "h4")
      return (
        <Tag
          className={cn(
            "text-primary font-semibold",
            block.level === 1 ? "mt-6 mb-2 text-xl" : block.level === 2 ? "mt-5 mb-2 text-base" : "mt-4 mb-1.5 text-sm"
          )}
        >
          {block.text}
        </Tag>
      )
    }
    case "paragraph":
      return (
        <p className="mb-2 text-sm leading-relaxed">
          <InlineRuns runs={block.runs} citations={citations} />
        </p>
      )
    case "bullets":
      return (
        <ul className="mb-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineRuns runs={item} citations={citations} />
            </li>
          ))}
        </ul>
      )
    case "numbered":
      return (
        <ol className="mb-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed">
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineRuns runs={item} citations={citations} />
            </li>
          ))}
        </ol>
      )
    case "table":
      return (
        <div className="mb-3 overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                {block.header.map((cell, i) => (
                  <th key={i} className="px-2.5 py-1.5 text-left text-xs font-semibold">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className={cn("border-t", r % 2 === 1 && "bg-accent/50")}>
                  {row.map((cell, c) => (
                    <td key={c} className="px-2.5 py-1.5 align-top text-xs">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case "callout":
      return (
        <div
          className={cn(
            "mb-3 rounded-r-md border-l-[3px] px-3 py-2 text-sm leading-relaxed",
            CALLOUT_CLASSES[block.tone]
          )}
        >
          <span className="font-semibold">{CALLOUT_TONES[block.tone].label}: </span>
          <InlineRuns runs={block.runs} citations={citations} />
        </div>
      )
  }
}

export function LiveDocEditor({
  artifact,
  editRequest,
  onEditDone,
}: {
  artifact: Artifact
  editRequest: { id: number; text: string } | null
  onEditDone: (summary: string | null) => void
}) {
  const updateArtifact = useOrbit((s) => s.updateArtifact)
  const model = artifact.model
  const generating = artifact.status === "generating"

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [manualEdit, setManualEdit] = React.useState<{
    blockId: string
    text: string
  } | null>(null)
  const [pending, setPending] = React.useState<PendingChange | null>(null)

  /* ---------------- versioned commit ---------------- */

  const commit = React.useCallback(
    (nextModel: DocModel, summary: string) => {
      if (!model) return
      const prior: DocVersionEntry[] =
        artifact.versions && artifact.versions.length > 0
          ? artifact.versions
          : [
            {
              v: 1,
              summary: "Initial AI draft",
              at: artifact.createdAt,
              markdown: serializeDocModel(model),
            },
          ]
      const bumped: DocModel = {
        ...nextModel,
        meta: { ...nextModel.meta, revision: bumpRevision(model.meta.revision) },
      }
      const versions = [
        ...prior,
        {
          v: prior[prior.length - 1].v + 1,
          summary,
          at: new Date().toISOString(),
          markdown: serializeDocModel(bumped),
        },
      ].slice(-MAX_VERSIONS)
      persistDocDraft(artifact.id, serializeDocModel(bumped), versions)
      updateArtifact(artifact.id, {
        model: bumped,
        versions,
        title: bumped.meta.title,
        lastEditSummary: summary,
        updatedAt: new Date().toISOString(),
      })
    },
    [artifact.createdAt, artifact.id, artifact.versions, model, updateArtifact]
  )

  /* ---------------- AI edits (refine agent) ---------------- */

  const editRequestId = editRequest?.id
  React.useEffect(() => {
    if (!editRequest || !editRequestId || !model) return
    let cancelled = false
    const run = async () => {
      const targetIds = selectedId
        ? sectionBlockIds(model, selectedId).length > 0
          ? sectionBlockIds(model, selectedId)
          : [selectedId]
        : model.blocks.map((b) => b.id)
      const targetBlocks = model.blocks.filter((b) => targetIds.includes(b.id))
      const fragment = blocksToMarkdown(targetBlocks, model.citations, "tags")
      try {
        const { text } = await liveApi.refine({
          userInput: editRequest.text,
          toRefine: fragment,
          refineRequest:
            `${editRequest.text}. Return ONLY the revised markdown fragment — ` +
            "same markdown conventions (headings, GitHub tables, > [!note|risk|action] callouts), " +
            "keep every <source> citation tag intact, no commentary before or after.",
        })
        if (cancelled) return
        if (!text?.trim()) throw new Error("The refine agent returned nothing.")
        const parsed = parseFragment(text, model.citations)
        if (parsed.blocks.length === 0) {
          throw new Error("Couldn't parse the revised section.")
        }
        setPending({
          targetIds,
          newBlocks: parsed.blocks,
          citations: parsed.citations,
          summary:
            editRequest.text.length > 80
              ? `${editRequest.text.slice(0, 79)}…`
              : editRequest.text,
        })
        onEditDone(null) // response arrived — re-enable the edit bar
      } catch (error) {
        if (cancelled) return
        toast.error("AI edit failed", {
          description: error instanceof Error ? error.message : undefined,
        })
        onEditDone(null)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run per request id only
  }, [editRequestId])

  const acceptPending = () => {
    if (!pending || !model) return
    const start = model.blocks.findIndex((b) => b.id === pending.targetIds[0])
    const blocks = model.blocks.filter((b) => !pending.targetIds.includes(b.id))
    blocks.splice(start < 0 ? blocks.length : start, 0, ...pending.newBlocks)
    commit(
      { ...model, blocks, citations: pending.citations },
      pending.summary
    )
    setPending(null)
    setSelectedId(null)
    toast.success("Edit applied", { description: pending.summary })
  }

  const rejectPending = () => {
    setPending(null)
    toast("Edit discarded")
  }

  /* ---------------- manual block edits ---------------- */

  const startManualEdit = (block: Block) => {
    if (!model || generating || pending) return
    setManualEdit({
      blockId: block.id,
      text: blocksToMarkdown([block], model.citations, "markers"),
    })
  }

  const commitManualEdit = () => {
    if (!manualEdit || !model) return
    const replacement = parseBlocks(manualEdit.text)
    const index = model.blocks.findIndex((b) => b.id === manualEdit.blockId)
    if (index === -1) return setManualEdit(null)
    const blocks = [...model.blocks]
    blocks.splice(index, 1, ...replacement)
    commit({ ...model, blocks }, "Manual edit")
    setManualEdit(null)
  }

  /* ---------------- render ---------------- */

  if (!model) {
    return (
      <div className="space-y-2 p-8">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
    )
  }

  const pendingStart = pending
    ? model.blocks.findIndex((b) => b.id === pending.targetIds[0])
    : -1
  const usedCitations = (() => {
    const used = citedNumbers(model.blocks)
    const cited = model.citations.filter((c) => used.includes(c.n))
    return cited.length > 0 ? cited : model.citations
  })()

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-muted-foreground text-xs">
          {generating ? (
            <span className="thinking-shimmer">AI is drafting…</span>
          ) : pending ? (
            "Review the tracked change below"
          ) : selectedId ? (
            "Section selected — AI edits apply to it; Esc to clear"
          ) : (
            "Click a block to scope AI edits · pencil to edit text directly"
          )}
        </span>
        {model.parseWarnings.length > 0 && !generating && (
          <span className="text-muted-foreground/70 ml-auto text-[10px]">
            imported loosely
          </span>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div
          className="mx-auto max-w-2xl px-8 py-8"
          onKeyDown={(e) => {
            if (e.key === "Escape") setSelectedId(null)
          }}
        >
          {/* Document masthead — mirrors the export cover */}
          <p className="text-primary mb-1 text-xs font-semibold tracking-wide">
            Jacobs <span className="text-muted-foreground font-normal">· Orbit Docs</span>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{model.meta.title}</h1>
          <p className="text-muted-foreground mt-1 mb-6 border-b pb-4 text-xs">
            {[
              model.meta.subtitle,
              model.meta.project,
              model.meta.revision,
              model.meta.date,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>

          {model.blocks.map((block, index) => {
            const isTarget = pending?.targetIds.includes(block.id) ?? false
            const isSelected =
              !pending && selectedId !== null &&
              sectionBlockIds(model, selectedId).includes(block.id)
            const editingThis = manualEdit?.blockId === block.id

            return (
              <React.Fragment key={block.id}>
                {/* tracked change: replacement renders before the old target run */}
                {pending && index === pendingStart && (
                  <div className="border-primary/40 bg-accent/40 animate-in fade-in my-3 rounded-md border border-dashed p-3 duration-300">
                    <p className="text-primary mb-2 text-[10px] font-semibold tracking-wide uppercase">
                      AI suggestion
                    </p>
                    {pending.newBlocks.map((b) => (
                      <BlockView key={b.id} block={b} citations={pending.citations} />
                    ))}
                    <div className="mt-1 flex items-center gap-2">
                      <Button size="sm" className="h-6 gap-1 px-2 text-xs" onClick={acceptPending}>
                        <Check className="size-3" /> Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 gap-1 px-2 text-xs"
                        onClick={rejectPending}
                      >
                        <X className="size-3" /> Reject
                      </Button>
                    </div>
                  </div>
                )}

                {editingThis ? (
                  <div className="my-2">
                    <Textarea
                      autoFocus
                      value={manualEdit.text}
                      onChange={(e) =>
                        setManualEdit({ ...manualEdit, text: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          commitManualEdit()
                        }
                        if (e.key === "Escape") setManualEdit(null)
                      }}
                      className="min-h-24 font-mono text-xs"
                    />
                    <div className="mt-1.5 flex items-center gap-2">
                      <Button size="sm" className="h-6 px-2 text-xs" onClick={commitManualEdit}>
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => setManualEdit(null)}
                      >
                        Cancel
                      </Button>
                      <span className="text-muted-foreground text-[10px]">
                        markdown · Ctrl+Enter to save · citations stay as ⟦n⟧
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      !generating && !pending &&
                      setSelectedId(selectedId === block.id ? null : block.id)
                    }
                    className={cn(
                      "group relative -mx-2 rounded-md px-2 transition-colors",
                      !generating && !pending && "hover:bg-accent/40 cursor-pointer",
                      isSelected && "bg-accent/60 ring-ring/40 ring-1",
                      isTarget && "opacity-45 line-through decoration-destructive/50"
                    )}
                  >
                    <BlockView block={block} citations={model.citations} />
                    {!generating && !pending && !isTarget && (
                      <button
                        aria-label="Edit this block"
                        className="text-muted-foreground hover:text-foreground bg-background absolute top-1 -right-6 hidden rounded p-0.5 group-hover:block"
                        onClick={(e) => {
                          e.stopPropagation()
                          startManualEdit(block)
                        }}
                      >
                        <PencilLine className="size-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </React.Fragment>
            )
          })}

          {generating && (
            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-10/12" />
            </div>
          )}

          {/* References */}
          {!generating && usedCitations.length > 0 && (
            <div className="mt-8 border-t pt-4">
              <h3 className="text-primary mb-2 text-sm font-semibold">References</h3>
              {usedCitations.map((c) => (
                <p key={c.n} className="text-muted-foreground mb-1 text-xs">
                  [{c.n}] {c.docName || "Source document"}
                  {c.pagesLabel ? ` — p. ${c.pagesLabel}` : ""}
                </p>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
