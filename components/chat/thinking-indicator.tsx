"use client"

import * as React from "react"
import {
  BookOpen,
  Brain,
  ChevronRight,
  ListTodo,
  PenLine,
  Scale,
  Search,
  Wrench,
} from "lucide-react"

import { DocIcon } from "@/components/doc-icon"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { useOrbit } from "@/lib/store"
import type { ChatMessage, ThinkingKind } from "@/lib/types"

const stepIcons: Record<ThinkingKind, React.ElementType> = {
  plan: ListTodo,
  search: Search,
  read: BookOpen,
  analyze: Scale,
  synthesize: PenLine,
  tool: Wrench,
}

export function ThinkingIndicator({ message }: { message: ChatMessage }) {
  const docs = useOrbit((s) => s.docs)
  const thinking = message.thinking ?? []
  const active = message.phase === "thinking"
  const [open, setOpen] = React.useState(active)

  /* Follow `active` (expand while thinking, auto-collapse once the answer
     starts streaming) without an effect: adjust during render on the
     transition, which leaves the user's manual toggles untouched otherwise. */
  const [prevActive, setPrevActive] = React.useState(active)
  if (active !== prevActive) {
    setPrevActive(active)
    setOpen(active)
  }

  if (thinking.length === 0 && !active) return null

  const readCount = new Set(thinking.flatMap((t) => t.docIds ?? [])).size

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-3">
      <CollapsibleTrigger
        className={cn(
          "group text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs font-medium transition-colors",
          active && "text-foreground"
        )}
      >
        {active ? (
          <>
            <Spinner className="size-3.5" />
            <span className="thinking-shimmer">
              {thinking.length === 0
                ? "Thinking…"
                : thinking[thinking.length - 1].label}
            </span>
          </>
        ) : (
          <>
            <Brain className="size-3.5" />
            <span>
              Thought through {thinking.length} steps
              {readCount > 0 &&
                ` · consulted ${readCount} ${readCount === 1 ? "document" : "documents"}`}
            </span>
          </>
        )}
        <ChevronRight
          className={cn(
            "size-3 transition-transform group-data-[state=open]:rotate-90"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-muted mt-2 space-y-0 border-l-2 pl-4">
          {thinking.map((step, i) => {
            const Icon = stepIcons[step.kind]
            const isLatest = active && i === thinking.length - 1
            return (
              <div
                key={step.id}
                className={cn(
                  "animate-in fade-in slide-in-from-bottom-1 relative py-1.5 duration-300",
                  isLatest && "opacity-100"
                )}
              >
                <div className="flex items-start gap-2">
                  <Icon
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      isLatest
                        ? "text-foreground animate-pulse"
                        : "text-muted-foreground"
                    )}
                  />
                  <div className="min-w-0 space-y-0.5">
                    <p
                      className={cn(
                        "text-xs leading-snug",
                        isLatest
                          ? "text-foreground font-medium"
                          : "text-muted-foreground"
                      )}
                    >
                      {step.label}
                    </p>
                    {step.detail && (
                      <p className="text-muted-foreground/70 text-xs leading-snug">
                        {step.detail}
                      </p>
                    )}
                    {step.docIds && step.docIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {step.docIds.map((docId) => {
                          const doc = docs.find((d) => d.id === docId)
                          if (!doc) return null
                          return (
                            <Badge
                              key={docId}
                              variant="outline"
                              className="h-5 max-w-56 gap-1 px-1.5 text-[10px] font-normal"
                            >
                              <DocIcon type={doc.type} className="size-2.5" />
                              <span className="truncate">{doc.name}</span>
                            </Badge>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {active && thinking.length === 0 && (
            <p className="text-muted-foreground animate-pulse py-1.5 text-xs">
              Reading the request…
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
