"use client"

import * as React from "react"
import { CheckCircle2, CloudUpload, FilePlus2, X } from "lucide-react"
import { toast } from "sonner"

import { DocIcon } from "@/components/doc-icon"
import { Button } from "@/components/ui/button"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { formatSize } from "@/lib/format"
import { uid, useOrbit } from "@/lib/store"
import type { Doc, DocType } from "@/lib/types"

interface PendingFile {
  id: string
  name: string
  type: DocType
  sizeKB: number
  /** doc id once the simulated upload has started */
  docId?: string
}

const sampleFiles: Array<Pick<PendingFile, "name" | "type" | "sizeKB">> = [
  { name: "Initech Services Agreement (draft).pdf", type: "pdf", sizeKB: 1840 },
  { name: "FY27 Headcount Plan.xlsx", type: "xlsx", sizeKB: 388 },
  { name: "Partner Launch Brief.docx", type: "docx", sizeKB: 152 },
]

function typeFromName(name: string): DocType {
  const ext = name.split(".").pop()?.toLowerCase()
  if (ext === "pdf") return "pdf"
  if (ext === "xlsx" || ext === "xls") return "xlsx"
  if (ext === "pptx" || ext === "ppt") return "pptx"
  if (ext === "csv") return "csv"
  if (ext === "md") return "md"
  return "docx"
}

const stageLabel: Record<string, string> = {
  uploading: "Uploading",
  processing: "Extracting text",
  indexing: "Building index",
  ready: "Ready",
}

export function UploadDialog({
  open,
  onOpenChange,
  defaultFolderId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultFolderId?: string | null
}) {
  const folders = useOrbit((s) => s.folders)
  const docs = useOrbit((s) => s.docs)
  const addDoc = useOrbit((s) => s.addDoc)
  const updateDoc = useOrbit((s) => s.updateDoc)
  const pushActivity = useOrbit((s) => s.pushActivity)

  const [files, setFiles] = React.useState<PendingFile[]>([])
  const [folderId, setFolderId] = React.useState<string>(
    defaultFolderId ?? "f-finance"
  )
  const [dragging, setDragging] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const timers = React.useRef<ReturnType<typeof setInterval>[]>([])

  React.useEffect(() => {
    if (defaultFolderId) setFolderId(defaultFolderId)
  }, [defaultFolderId])

  React.useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearInterval)
  }, [])

  const uploadingDocs = docs.filter((d) =>
    files.some((f) => f.docId === d.id)
  )
  const allDone =
    running &&
    uploadingDocs.length > 0 &&
    uploadingDocs.every((d) => d.status === "ready")

  const queue = (items: Array<Pick<PendingFile, "name" | "type" | "sizeKB">>) =>
    setFiles((prev) => [
      ...prev,
      ...items.map((f) => ({ ...f, id: uid("file") })),
    ])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const dropped = Array.from(e.dataTransfer.files ?? [])
    if (dropped.length) {
      queue(
        dropped.map((f) => ({
          name: f.name,
          type: typeFromName(f.name),
          sizeKB: Math.max(1, Math.round(f.size / 1024)),
        }))
      )
    } else {
      queue(sampleFiles)
    }
  }

  const start = () => {
    setRunning(true)
    setFiles((prev) =>
      prev.map((file) => {
        if (file.docId) return file
        const docId = uid("d")
        const doc: Doc = {
          id: docId,
          name: file.name,
          type: file.type,
          folderId,
          source: "upload",
          status: "uploading",
          sizeKB: file.sizeKB,
          pages: Math.max(2, Math.round(file.sizeKB / 120)),
          owner: "Rohit Tokala",
          updatedAt: new Date().toISOString(),
          tags: [],
          summary: "Freshly uploaded — summary will appear once indexing completes.",
          version: 1,
          progress: 0,
        }
        addDoc(doc)
        const timer = setInterval(() => {
          const current = useOrbit.getState().docs.find((d) => d.id === docId)
          if (!current) return clearInterval(timer)
          const next = Math.min(100, (current.progress ?? 0) + 4 + Math.random() * 9)
          const status =
            next >= 100
              ? "ready"
              : next > 78
                ? "indexing"
                : next > 45
                  ? "processing"
                  : "uploading"
          updateDoc(docId, {
            progress: next,
            status,
            ...(status === "ready"
              ? {
                  progress: undefined,
                  summary:
                    "Indexed and searchable. Ask about this document in Chat to see grounded answers with citations.",
                }
              : null),
          })
          if (next >= 100) {
            clearInterval(timer)
            toast.success(`${file.name} is indexed and ready`)
          }
        }, 350)
        timers.current.push(timer)
        return { ...file, docId }
      })
    )
    pushActivity({
      kind: "upload",
      text: `Uploaded ${files.length} ${files.length === 1 ? "file" : "files"}`,
      detail: folders.find((f) => f.id === folderId)?.name,
    })
  }

  const reset = () => {
    setFiles([])
    setRunning(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Upload documents</DialogTitle>
          <DialogDescription>
            Files are OCR&apos;d, chunked, and indexed so the assistant can cite
            them precisely.
          </DialogDescription>
        </DialogHeader>

        {!running && (
          <>
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors",
                dragging
                  ? "border-primary bg-primary/5"
                  : "hover:border-muted-foreground/50"
              )}
            >
              <CloudUpload className="text-muted-foreground size-8" />
              <p className="text-sm font-medium">
                Drop files here or click to browse
              </p>
              <p className="text-muted-foreground text-xs">
                PDF, Word, Excel, PowerPoint, CSV, Markdown · up to 200 MB
              </p>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? [])
                  queue(
                    picked.map((f) => ({
                      name: f.name,
                      type: typeFromName(f.name),
                      sizeKB: Math.max(1, Math.round(f.size / 1024)),
                    }))
                  )
                  e.target.value = ""
                }}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => queue(sampleFiles)}
            >
              <FilePlus2 /> Add sample files instead
            </Button>
          </>
        )}

        {files.length > 0 && (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {files.map((file) => {
              const doc = docs.find((d) => d.id === file.docId)
              return (
                <div
                  key={file.id}
                  className="flex items-center gap-3 rounded-md border p-2.5"
                >
                  <DocIcon type={file.type} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{file.name}</p>
                    {doc && doc.status !== "ready" ? (
                      <div className="mt-1 flex items-center gap-2">
                        <Progress value={doc.progress ?? 0} className="h-1" />
                        <span className="text-muted-foreground w-24 shrink-0 text-xs">
                          {stageLabel[doc.status]}
                        </span>
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        {formatSize(file.sizeKB)}
                        {doc?.status === "ready" && " · Indexed"}
                      </p>
                    )}
                  </div>
                  {doc?.status === "ready" ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                  ) : !running ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove file"
                      onClick={() =>
                        setFiles((prev) => prev.filter((f) => f.id !== file.id))
                      }
                    >
                      <X />
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Label htmlFor="upload-dest" className="shrink-0">
            Destination
          </Label>
          <Select value={folderId} onValueChange={setFolderId} disabled={running}>
            <SelectTrigger id="upload-dest" className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {folders
                .filter((f) => f.source === "upload")
                .map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.parentId ? "· " : ""}
                    {f.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          {allDone ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={start} disabled={files.length === 0 || running}>
                {running
                  ? "Uploading…"
                  : `Upload ${files.length > 0 ? files.length : ""} ${
                      files.length === 1 ? "file" : "files"
                    }`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
