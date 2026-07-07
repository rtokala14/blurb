"use client"

import * as React from "react"
import { GitBranch, Quote, Sparkles } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { activePath, siblingsOf } from "@/lib/store"
import type { ChatSession } from "@/lib/types"

/**
 * Session outline: one entry per user turn on the active path. Click to jump;
 * branch points and artifact turns are flagged.
 */
export function TurnsNavigator({
  session,
  activeMessageId,
  onJump,
}: {
  session: ChatSession
  activeMessageId: string | null
  onJump: (messageId: string) => void
}) {
  const path = activePath(session)
  const turns = path.filter((m) => m.role === "user")

  return (
    <div className="flex h-full w-56 flex-col border-l">
      <div className="border-b px-3 py-2.5">
        <h3 className="text-sm font-semibold">Turns</h3>
        <p className="text-muted-foreground text-xs">
          {turns.length} {turns.length === 1 ? "exchange" : "exchanges"} on this
          branch
        </p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 p-2">
          {turns.map((turn, i) => {
            const reply = path.find(
              (m) => m.parentId === turn.id && m.role === "assistant"
            )
            const branched =
              siblingsOf(session, turn).length > 1 ||
              (reply ? siblingsOf(session, reply).length > 1 : false)
            const citations = reply?.citations?.length ?? 0
            const hasArtifact = (reply?.artifactIds?.length ?? 0) > 0
            const isActive =
              activeMessageId === turn.id || activeMessageId === reply?.id

            return (
              <button
                key={turn.id}
                onClick={() => onJump(turn.id)}
                className={cn(
                  "hover:bg-accent w-full rounded-md px-2 py-2 text-left transition-colors",
                  isActive && "bg-accent"
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs leading-snug">
                      {turn.content}
                    </p>
                    <div className="text-muted-foreground mt-1 flex items-center gap-2 text-[10px]">
                      {citations > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-0.5">
                              <Quote className="size-2.5" /> {citations}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {citations} citations in the reply
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {hasArtifact && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-0.5">
                              <Sparkles className="size-2.5" /> artifact
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            Created an artifact
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {branched && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-chart-4 flex items-center gap-0.5">
                              <GitBranch className="size-2.5" /> branch point
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            Alternate branches exist here
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
          {turns.length === 0 && (
            <p className="text-muted-foreground px-2 py-4 text-xs">
              Turns will appear here as the conversation grows.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
