"use client"

import * as React from "react"
import { StickyNote } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { Artifact } from "@/lib/types"

interface Slide {
  title: string
  bullets: string[]
  note: string
}

const slides: Slide[] = [
  {
    title: "Executive summary",
    bullets: [
      "Revenue tracking +9% vs. forecast, driven by enterprise expansion",
      "Vendor consolidation on track: $74k annualized savings identified",
      "Two renewal decisions required before end of quarter",
    ],
    note: "Figures sourced from the Q3 forecast narrative, p.2 — open with the savings headline.",
  },
  {
    title: "Financial performance",
    bullets: [
      "Gross margin steady at 78% despite infrastructure headwinds",
      "Trailing-twelve-month vendor spend up 18% — concentrated in two vendors",
      "Q3 overages trending down after usage-policy rollout",
    ],
    note: "Cite the Q3 Vendor Spend Analysis, sheet 2, for the YoY delta.",
  },
  {
    title: "Platform & product",
    bullets: [
      "Weekly active seats +12% QoQ across enterprise workspaces",
      "Intelligence layer beta adopted by 40% of eligible accounts",
      "Reliability: 99.97% availability, zero Sev-1 incidents",
    ],
    note: "Usage export (June) backs each figure — reference in appendix.",
  },
  {
    title: "Go-to-market",
    bullets: [
      "Pipeline coverage at 3.4x for Q4 target",
      "Win rate up 5pts where battlecards were used in-cycle",
      "Two lighthouse renewals closed with multi-year terms",
    ],
    note: "Battlecard stat comes from Sales Enablement July review.",
  },
  {
    title: "Risks & mitigations",
    bullets: [
      "Acme renewal: notice window passed — reservation-of-rights letter in motion",
      "OCR backlog on legacy scans may delay legal discovery requests",
      "Single-region customers pending residency commitments",
    ],
    note: "Pause here for discussion — legal owns the first risk.",
  },
  {
    title: "Asks",
    bullets: [
      "Approve CFO escalation path for both renewals",
      "Fund OCR re-processing for legacy archive (est. $12k)",
      "Headcount: +1 knowledge-ops analyst in Q4",
    ],
    note: "Close with the three asks; each maps to a prior slide.",
  },
]

export function DeckEditor({
  artifact,
  editRequest,
  onEditDone,
}: {
  artifact: Artifact
  editRequest: { id: number; text: string } | null
  onEditDone: (summary: string) => void
}) {
  const generating = artifact.status === "generating"
  const [revealed, setRevealed] = React.useState(generating ? 0 : slides.length)
  const [current, setCurrent] = React.useState(0)
  const [rewritten, setRewritten] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!generating) {
      setRevealed(slides.length)
      return
    }
    setRevealed(0)
    const interval = setInterval(() => {
      setRevealed((r) => {
        if (r >= slides.length) {
          clearInterval(interval)
          return r
        }
        setCurrent(Math.min(r, slides.length - 1))
        return r + 1
      })
    }, 1400)
    return () => clearInterval(interval)
  }, [generating])

  /* simulated AI edit: punch up the current slide */
  React.useEffect(() => {
    if (!editRequest) return
    const timer = setTimeout(() => {
      setRewritten(current)
      onEditDone(`Rewrote slide ${current + 1} (“${slides[current].title}”) per your request.`)
    }, 1800)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest, onEditDone])

  const slide = slides[Math.min(current, slides.length - 1)]

  return (
    <div className="flex h-full min-h-0">
      {/* Thumbnails */}
      <div className="w-24 shrink-0 border-r sm:w-40">
        <ScrollArea className="h-full">
          <div className="space-y-2 p-2.5">
            {slides.map((s, i) => (
              <button
                key={i}
                onClick={() => i < revealed && setCurrent(i)}
                className={cn(
                  "bg-card w-full rounded-md border p-2 text-left transition-shadow",
                  current === i && "ring-primary ring-2",
                  i >= revealed && "opacity-50"
                )}
                aria-label={`Slide ${i + 1}`}
              >
                <p className="text-muted-foreground mb-1 text-[9px] tabular-nums">
                  {i + 1}
                </p>
                {i < revealed ? (
                  <>
                    <p className="line-clamp-1 text-[10px] font-semibold">
                      {s.title}
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {s.bullets.slice(0, 3).map((_, j) => (
                        <div key={j} className="bg-muted-foreground/20 h-0.5 rounded-full" />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="space-y-1">
                    <Skeleton className="h-2 w-4/5" />
                    <Skeleton className="h-1 w-full" />
                    <Skeleton className="h-1 w-3/4" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Canvas */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="bg-muted/40 flex flex-1 items-center justify-center p-6">
          <div className="bg-card flex aspect-video w-full max-w-2xl flex-col rounded-md border p-8 shadow-sm">
            {generating && current >= revealed ? (
              <div className="space-y-3">
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            ) : (
              <>
                <h2 className="mb-5 text-2xl font-semibold tracking-tight">
                  {slide.title}
                </h2>
                <ul className="space-y-3">
                  {slide.bullets.map((bullet, i) => (
                    <li
                      key={`${rewritten === current ? "rw" : "base"}-${i}`}
                      className={cn(
                        "animate-in fade-in slide-in-from-bottom-1 flex items-start gap-2.5 text-sm leading-relaxed duration-500",
                        rewritten === current && "ai-insertion w-fit"
                      )}
                      style={{ animationDelay: `${i * 120}ms` }}
                    >
                      <span className="bg-primary mt-2 size-1.5 shrink-0 rounded-full" />
                      {rewritten === current
                        ? bullet.replace(/^([A-Z])/, (m) => m) + " (sharpened)"
                        : bullet}
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground mt-auto pt-4 text-[10px]">
                  {artifact.title} · slide {current + 1} of {slides.length} ·
                  sources cited in notes
                </p>
              </>
            )}
          </div>
        </div>

        {/* Speaker notes */}
        <div className="border-t px-4 py-3">
          <p className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-medium">
            <StickyNote className="size-3" /> Speaker notes
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {current < revealed ? slide.note : "Generating…"}
          </p>
        </div>
      </div>
    </div>
  )
}
