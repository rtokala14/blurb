"use client"

import * as React from "react"
import { Monitor } from "lucide-react"

import { useOrbit } from "@/lib/store"
import type { Doc } from "@/lib/types"

/**
 * "Synced" tab. SharePoint sync sources were removed in the v3 pipeline — the
 * sources list is always empty — so the browse/search/folder-docs endpoints no
 * longer exist and this tab now only renders the empty state. The props are
 * kept so the documents panel wiring is unchanged.
 */
export function SyncSourcesTab({
  selected: _selected,
  onToggleDocs: _onToggleDocs,
  onPreviewDoc: _onPreviewDoc,
}: {
  selected: Set<string>
  onToggleDocs: (add: string[], remove: string[]) => void
  onPreviewDoc: (doc: Doc) => void
}) {
  const sites = useOrbit((s) => s.sites)

  // v3 never populates sync sources; guard anyway so the panel stays stable if
  // demo seeds ever add sites.
  if (sites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <div className="border-border/60 bg-muted/40 flex size-12 items-center justify-center rounded-2xl border">
          <Monitor className="text-muted-foreground/40 size-5" />
        </div>
        <div>
          <p className="text-sm font-medium">No synced sources</p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            Upload documents to your library to ground chats — external sync
            sources aren&apos;t available in this workspace.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 px-1 pb-4">
      <div className="flex items-center gap-2 px-1 pt-0.5 pb-1">
        <span className="text-muted-foreground/70 text-[10px] font-semibold tracking-wide uppercase">
          Sync sources
        </span>
        <div className="bg-border/50 h-px flex-1" />
        <span className="text-muted-foreground/60 text-[10px] tabular-nums">
          {sites.length}
        </span>
      </div>
      {sites.map((site) => (
        <div
          key={site.id}
          className="border-border/50 bg-background/40 flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{site.name}</p>
            <p className="text-muted-foreground/70 mt-1 text-[10px]">
              This source is no longer browsable.
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
