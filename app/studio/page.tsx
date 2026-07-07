"use client"

import * as React from "react"
import Link from "next/link"
import { Sparkles } from "lucide-react"

import { artifactMeta } from "@/components/chat/artifact-card"
import { StudioPanel } from "@/components/studio/studio-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { TimeAgo } from "@/components/time-ago"
import { useOrbit } from "@/lib/store"

export default function StudioPage() {
  const artifacts = useOrbit((s) => s.artifacts)
  const [selectedId, setSelectedId] = React.useState<string | null>(
    artifacts[0]?.id ?? null
  )
  const selected = artifacts.find((a) => a.id === selectedId) ?? artifacts[0]

  if (artifacts.length === 0) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Sparkles />
          </EmptyMedia>
          <EmptyTitle>Nothing drafted yet</EmptyTitle>
          <EmptyDescription>
            Ask the assistant to create a document, spreadsheet, or deck — try
            “/doc”, “/sheet”, or “/deck” in chat.
          </EmptyDescription>
        </EmptyHeader>
        <Button asChild>
          <Link href="/chat">Open chat</Link>
        </Button>
      </Empty>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Artifact list */}
      <aside className="flex w-80 shrink-0 flex-col border-r">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">AI artifacts</h2>
          <p className="text-muted-foreground text-xs">
            Documents, spreadsheets, and decks drafted by the agent — every
            figure traceable to a source.
          </p>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1.5 p-2">
            {artifacts.map((artifact) => {
              const meta = artifactMeta[artifact.kind]
              return (
                <button
                  key={artifact.id}
                  onClick={() => setSelectedId(artifact.id)}
                  className={cn(
                    "hover:bg-accent w-full rounded-lg border p-3 text-left transition-colors",
                    selected?.id === artifact.id && "border-primary/40 bg-accent"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <meta.icon className={cn("size-4 shrink-0", meta.className)} />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">
                      {artifact.title}
                    </p>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {meta.label}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1.5 line-clamp-2 text-xs">
                    {artifact.lastEditSummary ?? "AI draft"}
                  </p>
                  <p className="text-muted-foreground mt-1 text-[10px]">
                    Updated <TimeAgo iso={artifact.updatedAt} /> ·{" "}
                    {artifact.sourceDocIds.length} sources
                  </p>
                </button>
              )
            })}
          </div>
        </ScrollArea>
      </aside>

      {/* Editor */}
      <div className="min-w-0 flex-1">
        {selected && <StudioPanel artifact={selected} standalone />}
      </div>
    </div>
  )
}
