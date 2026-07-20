"use client"

import * as React from "react"
import { CheckCircle2, Download, FileDown } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { downloadBlob, generateSessionExport } from "@/lib/export-session"
import { activePath, countBranches, useOrbit } from "@/lib/store"
import type { ChatSession } from "@/lib/types"

type Format = "pdf" | "markdown" | "docx"

const formatMeta: Record<Format, { label: string; hint: string; ext: string }> = {
  pdf: { label: "PDF", hint: "Print-ready, with linked citation footnotes", ext: "pdf" },
  markdown: { label: "Markdown", hint: "Portable plain text for wikis and notes", ext: "md" },
  docx: { label: "Word", hint: "Editable document for further drafting", ext: "docx" },
}

export function ExportDialog({
  session,
  open,
  onOpenChange,
}: {
  session: ChatSession
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const pushActivity = useOrbit((s) => s.pushActivity)
  const [format, setFormat] = React.useState<Format>("pdf")
  const [includeCitations, setIncludeCitations] = React.useState(true)
  const [includeThinking, setIncludeThinking] = React.useState(false)
  const [includeBranches, setIncludeBranches] = React.useState(false)
  const [state, setState] = React.useState<"idle" | "working" | "done">("idle")
  const [progress, setProgress] = React.useState(0)
  const blobRef = React.useRef<Blob | null>(null)

  const path = activePath(session)
  const turns = path.length
  const citations = path.reduce((n, m) => n + (m.citations?.length ?? 0), 0)
  const branches = countBranches(session)

  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    // Reset the visible export state when the dialog closes. blobRef isn't
    // touched here — a ref must not be mutated during render, and its value is
    // only read while state === "done", then overwritten by the next export.
    if (!open) {
      setState("idle")
      setProgress(0)
    }
  }

  const fileName = `${session.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}.${formatMeta[format].ext}`

  const start = async () => {
    setState("working")
    setProgress(15)
    try {
      // generation is fast; the brief progress keeps the transition legible
      const generated = await generateSessionExport(session, format, {
        includeCitations,
        includeThinking,
      })
      setProgress(100)
      blobRef.current = generated
      setState("done")
      pushActivity({
        kind: "export",
        text: `Session exported to ${formatMeta[format].label}`,
        detail: `${session.title} · ${turns} turns`,
      })
    } catch (error) {
      setState("idle")
      setProgress(0)
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export session</DialogTitle>
          <DialogDescription>
            {turns} turns · {citations} citations · {branches}{" "}
            {branches === 1 ? "branch" : "branches"}
          </DialogDescription>
        </DialogHeader>

        {state === "done" ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="size-10 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-sm font-medium">Export ready</p>
              <p className="text-muted-foreground font-mono text-xs">{fileName}</p>
            </div>
            <Button
              onClick={() => {
                if (blobRef.current) downloadBlob(blobRef.current, fileName)
                toast("Download started", { description: fileName })
                onOpenChange(false)
              }}
            >
              <Download /> Download
            </Button>
          </div>
        ) : state === "working" ? (
          <div className="space-y-3 py-6">
            <p className="text-muted-foreground text-center text-sm">
              Rendering {formatMeta[format].label}
              {includeCitations && " · resolving citation links"}…
            </p>
            <Progress value={progress} />
          </div>
        ) : (
          <>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as Format)}
              className="gap-2"
            >
              {(Object.keys(formatMeta) as Format[]).map((f) => (
                <Label
                  key={f}
                  className="has-data-[state=checked]:border-primary flex cursor-pointer items-start gap-3 rounded-md border p-3"
                >
                  <RadioGroupItem value={f} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">{formatMeta[f].label}</p>
                    <p className="text-muted-foreground text-xs">
                      {formatMeta[f].hint}
                    </p>
                  </div>
                </Label>
              ))}
            </RadioGroup>

            <div className="space-y-2.5 pt-1">
              <Label className="flex items-center gap-2 text-sm font-normal">
                <Checkbox
                  checked={includeCitations}
                  onCheckedChange={(v) => setIncludeCitations(v === true)}
                />
                Include citations & source appendix
              </Label>
              <Label className="flex items-center gap-2 text-sm font-normal">
                <Checkbox
                  checked={includeThinking}
                  onCheckedChange={(v) => setIncludeThinking(v === true)}
                />
                Include agent reasoning traces
              </Label>
              <Label className="flex items-center gap-2 text-sm font-normal">
                <Checkbox
                  checked={includeBranches}
                  onCheckedChange={(v) => setIncludeBranches(v === true)}
                />
                Include alternate branches ({branches - 1})
              </Label>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={start}>
                <FileDown /> Export
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
