"use client"

import * as React from "react"
import {
  AlignLeft,
  Bold,
  Check,
  Heading1,
  Italic,
  List,
  Underline,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { Artifact } from "@/lib/types"

interface Section {
  heading: string
  paragraphs: string[]
}

const sections: Section[] = [
  {
    heading: "1. Objective",
    paragraphs: [
      "Secure renewal on improved commercial terms while preserving service continuity. Target outcome: a 10% reduction in annualized fees with uptime credits applied to the first invoice of the new term.",
    ],
  },
  {
    heading: "2. Leverage",
    paragraphs: [
      "Two consecutive quarters of missed availability commitments entitle us to $18.4k in unclaimed service credits — a documented, contractual lever.",
      "The SLA exit ramp (three consecutive months below 99.5%) is one month from vesting, materially strengthening our alternatives.",
    ],
  },
  {
    heading: "3. Asks & concession ladder",
    paragraphs: [
      "Open at a 14% reduction citing top-quartile benchmark outcomes; settle no lower than 8% plus credits. Trade term length (24 months) for pricing only after credits are locked.",
    ],
  },
  {
    heading: "4. BATNA",
    paragraphs: [
      "Consolidation onto the Northwind platform is viable within two quarters at comparable run-rate; migration costs are offset by the overlapping capability set.",
    ],
  },
  {
    heading: "5. Timeline",
    paragraphs: [
      "Reservation-of-rights letter this week; commercial sessions weeks 2–3; executive escalation path prepared for week 4 if positions harden.",
    ],
  },
]

export function DocEditor({
  artifact,
  editRequest,
  onEditDone,
}: {
  artifact: Artifact
  editRequest: { id: number; text: string } | null
  onEditDone: (summary: string) => void
}) {
  const generating = artifact.status === "generating"
  const [revealed, setRevealed] = React.useState(generating ? 0 : sections.length)
  const [insertion, setInsertion] = React.useState<{
    afterSection: number
    text: string
    resolved: boolean
  } | null>(null)

  /* progressive reveal while generating */
  React.useEffect(() => {
    if (!generating) {
      setRevealed(sections.length)
      return
    }
    setRevealed(0)
    // Local counter keeps the state updater pure (no clearInterval inside it).
    let count = 0
    const interval = setInterval(() => {
      if (count >= sections.length) {
        clearInterval(interval)
        return
      }
      count += 1
      setRevealed(count)
    }, 1500)
    return () => clearInterval(interval)
  }, [generating])

  /* simulated AI edit: insert a tracked paragraph */
  React.useEffect(() => {
    if (!editRequest) return
    const timer = setTimeout(() => {
      setInsertion({
        afterSection: 1,
        text: `Addendum (AI, per your request — “${editRequest.text.slice(0, 60)}${editRequest.text.length > 60 ? "…" : ""}”): benchmarking indicates peer buyers secured multi-year price locks in exchange for case-study participation; propose this as a no-cost concession.`,
        resolved: false,
      })
      onEditDone("Inserted a benchmarking addendum in the Leverage section.")
    }, 1800)
    return () => clearTimeout(timer)
  }, [editRequest, onEditDone])

  return (
    <div className="flex h-full flex-col">
      {/* Editor toolbar (placeholder) */}
      <div className="flex items-center gap-0.5 border-b px-2 py-1.5">
        {[Heading1, Bold, Italic, Underline, List, AlignLeft].map((Icon, i) => (
          <Button
            key={i}
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Formatting (placeholder)"
            onClick={() => toast("Formatting toolbar is a placeholder")}
          >
            <Icon />
          </Button>
        ))}
        <Separator orientation="vertical" className="mx-1 !h-4" />
        <span className="text-muted-foreground text-xs">
          {generating ? "AI is drafting…" : "AI-drafted passages are highlighted"}
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-2xl px-8 py-8">
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">
            {artifact.title}
          </h1>
          <p className="text-muted-foreground mb-6 text-xs">
            Drafted by Orbit · grounded in {artifact.sourceDocIds.length} source
            documents
          </p>

          {sections.map((section, i) => (
            <React.Fragment key={section.heading}>
              {i < revealed ? (
                <section className="animate-in fade-in mb-6 duration-500">
                  <h2 className="mb-2 text-base font-semibold">
                    {section.heading}
                  </h2>
                  {section.paragraphs.map((p, j) => (
                    <p
                      key={j}
                      className={cn(
                        "mb-2 text-sm leading-relaxed",
                        generating && i === revealed - 1 && "ai-insertion"
                      )}
                    >
                      {p}
                    </p>
                  ))}
                  {insertion && insertion.afterSection === i && (
                    <div className="animate-in fade-in slide-in-from-bottom-1 my-3 duration-500">
                      <p
                        className={cn(
                          "text-sm leading-relaxed",
                          !insertion.resolved && "ai-insertion"
                        )}
                      >
                        {insertion.text}
                      </p>
                      {!insertion.resolved && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-muted-foreground text-xs">
                            AI suggestion
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 gap-1 px-2 text-xs"
                            onClick={() => {
                              setInsertion((cur) =>
                                cur ? { ...cur, resolved: true } : null
                              )
                              toast.success("Edit accepted")
                            }}
                          >
                            <Check className="size-3" /> Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 gap-1 px-2 text-xs"
                            onClick={() => {
                              setInsertion(null)
                              toast("Edit discarded")
                            }}
                          >
                            <X className="size-3" /> Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              ) : i === revealed && generating ? (
                <div className="mb-6 space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-11/12" />
                  <Skeleton className="h-3.5 w-4/5" />
                </div>
              ) : null}
            </React.Fragment>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
