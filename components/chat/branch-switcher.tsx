"use client"

import { ChevronLeft, ChevronRight, GitBranch } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { deepestLeaf, siblingsOf, useOrbit } from "@/lib/store"
import type { ChatMessage, ChatSession } from "@/lib/types"

export function BranchSwitcher({
  session,
  message,
}: {
  session: ChatSession
  message: ChatMessage
}) {
  const setLeaf = useOrbit((s) => s.setLeaf)
  const siblings = siblingsOf(session, message)
  if (siblings.length < 2) return null

  const index = siblings.findIndex((m) => m.id === message.id)

  const go = (target: ChatMessage) =>
    setLeaf(session.id, deepestLeaf(session, target.id))

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="text-muted-foreground flex items-center gap-0.5 text-xs">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            aria-label="Previous branch"
            disabled={index <= 0}
            onClick={() => go(siblings[index - 1])}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="flex items-center gap-1 tabular-nums">
            <GitBranch className="size-3" />
            {index + 1}/{siblings.length}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            aria-label="Next branch"
            disabled={index >= siblings.length - 1}
            onClick={() => go(siblings[index + 1])}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </TooltipTrigger>
      <TooltipContent>Switch between conversation branches</TooltipContent>
    </Tooltip>
  )
}
