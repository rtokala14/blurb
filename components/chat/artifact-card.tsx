"use client"

import {
  FileSpreadsheet,
  FileText,
  PanelRightOpen,
  Presentation,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { TimeAgo } from "@/components/time-ago"
import { useOrbit } from "@/lib/store"
import type { ArtifactKind } from "@/lib/types"

export const artifactMeta: Record<
  ArtifactKind,
  { icon: React.ElementType; label: string; className: string }
> = {
  doc: {
    icon: FileText,
    label: "Document",
    className: "text-blue-600 dark:text-blue-400",
  },
  sheet: {
    icon: FileSpreadsheet,
    label: "Spreadsheet",
    className: "text-emerald-600 dark:text-emerald-400",
  },
  deck: {
    icon: Presentation,
    label: "Presentation",
    className: "text-orange-600 dark:text-orange-400",
  },
}

export function ArtifactCard({ artifactId }: { artifactId: string }) {
  const artifact = useOrbit((s) => s.artifacts.find((a) => a.id === artifactId))
  const openArtifactId = useOrbit((s) => s.openArtifactId)
  const setOpenArtifact = useOrbit((s) => s.setOpenArtifact)
  if (!artifact) return null

  const meta = artifactMeta[artifact.kind]
  const Icon = meta.icon
  const generating = artifact.status === "generating"
  const isOpen = openArtifactId === artifact.id

  return (
    <button
      onClick={() => setOpenArtifact(isOpen ? null : artifact.id)}
      className={cn(
        "group hover:bg-muted/60 my-2 flex w-full max-w-md items-center gap-3 rounded-lg border p-3 text-left transition-colors",
        isOpen && "border-primary/40 bg-muted/40"
      )}
    >
      <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-md">
        {generating ? (
          <Spinner className="size-4" />
        ) : (
          <Icon className={cn("size-5", meta.className)} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{artifact.title}</p>
        <p className="text-muted-foreground text-xs">
          {generating ? (
            <span className="thinking-shimmer">Generating draft…</span>
          ) : (
            <>
              {meta.label} · updated <TimeAgo iso={artifact.updatedAt} />
            </>
          )}
        </p>
      </div>
      {generating ? (
        <Badge variant="outline" className="shrink-0">
          Drafting
        </Badge>
      ) : (
        <span className="text-muted-foreground group-hover:text-foreground flex shrink-0 items-center gap-1 text-xs">
          <PanelRightOpen className="size-3.5" />
          {isOpen ? "Close" : "Open in Studio"}
        </span>
      )}
    </button>
  )
}
