"use client"

import * as React from "react"
import { FunctionSquare } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { Artifact } from "@/lib/types"

const columns = ["A", "B", "C", "D", "E", "F"]

interface Cell {
  v: string
  formula?: string
  bold?: boolean
  num?: boolean
}

const baseRows: Cell[][] = [
  [
    { v: "Vendor", bold: true },
    { v: "FY26 spend", bold: true },
    { v: "YoY", bold: true },
    { v: "Renewal", bold: true },
    { v: "Risk", bold: true },
    { v: "Owner", bold: true },
  ],
  [
    { v: "Acme Cloud" },
    { v: "$412,300", num: true, formula: "=SUMIFS(Spend!C:C,Spend!A:A,A2)" },
    { v: "+18%", num: true },
    { v: "Sep 30" },
    { v: "High" },
    { v: "P. Raman" },
  ],
  [
    { v: "Northwind Analytics" },
    { v: "$168,000", num: true, formula: "=SUMIFS(Spend!C:C,Spend!A:A,A3)" },
    { v: "+6%", num: true },
    { v: "Oct 15" },
    { v: "Medium" },
    { v: "P. Raman" },
  ],
  [
    { v: "Globex Partners" },
    { v: "$94,500", num: true },
    { v: "−3%", num: true },
    { v: "Feb 28" },
    { v: "Low" },
    { v: "D. Whitfield" },
  ],
  [
    { v: "Initech Services" },
    { v: "$61,200", num: true },
    { v: "+11%", num: true },
    { v: "May 12" },
    { v: "Low" },
    { v: "M. Lee" },
  ],
  [
    { v: "Total", bold: true },
    { v: "$736,000", num: true, bold: true, formula: "=SUM(B2:B5)" },
    { v: "", },
    { v: "" },
    { v: "" },
    { v: "" },
  ],
]

const scenarioColumn: Cell[] = [
  { v: "Scenario −10%", bold: true },
  { v: "$371,070", num: true, formula: "=B2*0.9" },
  { v: "$151,200", num: true, formula: "=B3*0.9" },
  { v: "$85,050", num: true, formula: "=B4*0.9" },
  { v: "$55,080", num: true, formula: "=B5*0.9" },
  { v: "$662,400", num: true, bold: true, formula: "=SUM(G2:G5)" },
]

export function SheetEditor({
  artifact,
  editRequest,
  onEditDone,
}: {
  artifact: Artifact
  editRequest: { id: number; text: string } | null
  onEditDone: (summary: string) => void
}) {
  const generating = artifact.status === "generating"
  const [revealedRows, setRevealedRows] = React.useState(
    generating ? 0 : baseRows.length
  )
  const [selected, setSelected] = React.useState<{ r: number; c: number }>({
    r: 1,
    c: 1,
  })
  const [scenarioAdded, setScenarioAdded] = React.useState(false)
  const [flashScenario, setFlashScenario] = React.useState(false)

  React.useEffect(() => {
    if (!generating) {
      setRevealedRows(baseRows.length)
      return
    }
    setRevealedRows(0)
    const interval = setInterval(() => {
      setRevealedRows((r) => {
        if (r >= baseRows.length) {
          clearInterval(interval)
          return r
        }
        return r + 1
      })
    }, 1100)
    return () => clearInterval(interval)
  }, [generating])

  /* simulated AI edit: add a scenario column with formulas */
  React.useEffect(() => {
    if (!editRequest) return
    const timer = setTimeout(() => {
      setScenarioAdded(true)
      setFlashScenario(true)
      onEditDone("Added a −10% renewal scenario column with formulas.")
      setTimeout(() => setFlashScenario(false), 2600)
    }, 1800)
    return () => clearTimeout(timer)
  }, [editRequest, onEditDone])

  const allColumns = scenarioAdded ? [...columns, "G"] : columns
  const selectedCell =
    selected.c === 6
      ? scenarioColumn[selected.r]
      : baseRows[selected.r]?.[selected.c]

  return (
    <div className="flex h-full flex-col">
      {/* Formula bar */}
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          {allColumns[selected.c]}
          {selected.r + 1}
        </span>
        <FunctionSquare className="text-muted-foreground size-3.5" />
        <span className="text-muted-foreground flex-1 truncate font-mono text-xs">
          {selectedCell?.formula ?? selectedCell?.v ?? ""}
        </span>
        {generating && (
          <span className="thinking-shimmer text-xs">AI is building the model…</span>
        )}
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="bg-muted text-muted-foreground sticky top-0 w-10 border p-1 text-xs font-normal" />
              {allColumns.map((col, c) => (
                <th
                  key={col}
                  className={cn(
                    "bg-muted text-muted-foreground sticky top-0 border p-1 text-xs font-medium",
                    c === 6 && flashScenario && "bg-emerald-100 dark:bg-emerald-900/40"
                  )}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {baseRows.map((row, r) => (
              <tr key={r}>
                <td className="bg-muted text-muted-foreground border p-1 text-center text-xs tabular-nums">
                  {r + 1}
                </td>
                {r < revealedRows ? (
                  <>
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        onClick={() => setSelected({ r, c })}
                        className={cn(
                          "cursor-cell border px-2 py-1",
                          cell.bold && "font-semibold",
                          cell.num && "text-right tabular-nums",
                          selected.r === r &&
                            selected.c === c &&
                            "ring-primary bg-primary/5 ring-2 ring-inset"
                        )}
                      >
                        {cell.v}
                      </td>
                    ))}
                    {scenarioAdded && (
                      <td
                        onClick={() => setSelected({ r, c: 6 })}
                        className={cn(
                          "cursor-cell border px-2 py-1 text-right tabular-nums transition-colors",
                          scenarioColumn[r].bold && "font-semibold",
                          flashScenario && "bg-emerald-100 dark:bg-emerald-900/40",
                          selected.r === r &&
                            selected.c === 6 &&
                            "ring-primary bg-primary/5 ring-2 ring-inset"
                        )}
                      >
                        {scenarioColumn[r].v}
                      </td>
                    )}
                  </>
                ) : (
                  allColumns.map((_, c) => (
                    <td key={c} className="border px-2 py-1">
                      {r === revealedRows && (
                        <Skeleton className="h-3.5 w-full" />
                      )}
                    </td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sheet tabs */}
      <div className="border-t px-2 py-1">
        <Tabs defaultValue="model">
          <TabsList className="h-7">
            <TabsTrigger value="inputs" className="px-2.5 text-xs">
              Inputs
            </TabsTrigger>
            <TabsTrigger value="model" className="px-2.5 text-xs">
              Model
            </TabsTrigger>
            <TabsTrigger value="summary" className="px-2.5 text-xs">
              Summary
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  )
}
