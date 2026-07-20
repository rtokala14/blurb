"use client"

import { GitBranch, Quote, Sparkles } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { activePath, siblingsOf } from "@/lib/store"
import type { ChatSession } from "@/lib/types"

/**
 * Minimal scrollspy rail: one grey line per user turn on the active path,
 * current turn highlighted. Hover previews the query, click jumps to it.
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
  if (turns.length === 0) return null

  return (
    <nav
      aria-label="Turns"
      className="absolute top-1/2 right-2.5 z-10 flex -translate-y-1/2 flex-col items-end gap-2 max-sm:hidden"
    >
      {turns.map((turn, i) => {
        const reply = path.find(
          (m) => m.parentId === turn.id && m.role === "assistant"
        )
        const isActive =
          activeMessageId === turn.id || activeMessageId === reply?.id
        const branched =
          siblingsOf(session, turn).length > 1 ||
          (reply ? siblingsOf(session, reply).length > 1 : false)
        const citations = reply?.citations?.length ?? 0
        const hasArtifact = (reply?.artifactIds?.length ?? 0) > 0

        return (
          <Tooltip key={turn.id} delayDuration={100}>
            <TooltipTrigger asChild>
              <button type="button"
                onClick={() => onJump(turn.id)}
                aria-label={`Jump to turn ${i + 1}`}
                aria-current={isActive ? "true" : undefined}
                className="group flex h-2 items-center justify-end"
              >
                <span
                  className={cn(
                    "h-[3px] rounded-full transition-all duration-200",
                    isActive
                      ? "bg-foreground w-6"
                      : "bg-muted-foreground/25 group-hover:bg-muted-foreground/60 w-4 group-hover:w-5"
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={8} className="max-w-64">
              <p className="line-clamp-2">{turn.content}</p>
              {(citations > 0 || hasArtifact || branched) && (
                <p className="mt-1 flex items-center gap-2 opacity-70">
                  {citations > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Quote className="size-2.5" /> {citations}
                    </span>
                  )}
                  {hasArtifact && (
                    <span className="flex items-center gap-0.5">
                      <Sparkles className="size-2.5" /> artifact
                    </span>
                  )}
                  {branched && (
                    <span className="flex items-center gap-0.5">
                      <GitBranch className="size-2.5" /> branches
                    </span>
                  )}
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </nav>
  )
}
