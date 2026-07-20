"use client"

import * as React from "react"
import { CheckCircle2, CloudUpload, Mail, X } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { formatSize } from "@/lib/format"
import { liveApi } from "@/lib/live-api"
import { mapLiveDoc } from "@/lib/live-map"
import { uid, useOrbit } from "@/lib/store"
import type { DocType } from "@/lib/types"

interface PendingFile {
  id: string
  name: string
  type: DocType
  sizeKB: number
  /** doc id once the upload has started */
  docId?: string
  /** the real File to upload */
  file?: File
}

/** sentinel Select value standing in for "no folder" (the library root) */
const ROOT_FOLDER = "__root__"

function typeFromName(name: string): DocType {
  const ext = name.split(".").pop()?.toLowerCase()
  if (ext === "pdf") return "pdf"
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
  const updateDoc = useOrbit((s) => s.updateDoc)
  const pushActivity = useOrbit((s) => s.pushActivity)

  const [files, setFiles] = React.useState<PendingFile[]>([])
  const [folderId, setFolderId] = React.useState<string>(
    defaultFolderId ?? ROOT_FOLDER
  )
  const [dragging, setDragging] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const liveUserEmail = useOrbit((s) => s.liveUserEmail)
  const [notifyEnabled, setNotifyEnabled] = React.useState(true)
  const [notifyEmail, setNotifyEmail] = React.useState(
    liveUserEmail || "rohit.tokala@jacobs.com"
  )
  React.useEffect(() => {
    if (liveUserEmail) setNotifyEmail(liveUserEmail)
  }, [liveUserEmail])
  const inputRef = React.useRef<HTMLInputElement>(null)
  const timers = React.useRef<ReturnType<typeof setInterval>[]>([])
  /** the in-flight batch: notify once when every doc in it is ready */
  const batchRef = React.useRef<{
    ids: string[]
    email: string
    enabled: boolean
    notified: boolean
  } | null>(null)

  React.useEffect(() => {
    if (defaultFolderId) setFolderId(defaultFolderId)
  }, [defaultFolderId])

  React.useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearInterval)
  }, [])

  const queue = (items: Array<Pick<PendingFile, "name" | "type" | "sizeKB" | "file">>) =>
    setFiles((prev) => [
      ...prev,
      ...items.map((f) => ({ ...f, id: uid("file") })),
    ])

  const queueRealFiles = (list: File[]) =>
    queue(
      list.map((f) => ({
        name: f.name,
        type: typeFromName(f.name),
        sizeKB: Math.max(1, Math.round(f.size / 1024)),
        file: f,
      }))
    )

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const dropped = Array.from(e.dataTransfer.files ?? [])
    if (dropped.length) queueRealFiles(dropped)
  }

  /** POST the batch to the SendGrid-backed notification route. */
  const maybeNotify = React.useCallback(() => {
    const batch = batchRef.current
    if (!batch || !batch.enabled || batch.notified) return
    const { docs: currentDocs, folders: currentFolders, pushActivity: track } =
      useOrbit.getState()
    const batchDocs = batch.ids
      .map((id) => currentDocs.find((d) => d.id === id))
      .filter((d): d is NonNullable<typeof d> => !!d)
    if (batchDocs.length === 0 || !batchDocs.every((d) => d.status === "ready"))
      return
    batch.notified = true
    fetch("/api/notify-indexed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: batch.email,
        folderName: currentFolders.find((f) => f.id === batchDocs[0].folderId)
          ?.name,
        files: batchDocs.map((d) => ({ name: d.name, pages: d.pages })),
      }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (data.sent) {
          toast.success("Notification email sent", {
            description: `${batch.email} · via SendGrid`,
          })
        } else if (data.simulated) {
          toast("Batch indexed — notification simulated", {
            description: `Would email ${batch.email}. Add SENDGRID_API_KEY to send for real.`,
            icon: <Mail className="size-4" />,
          })
        } else {
          toast.error("Notification email failed", {
            description: data.error ?? `HTTP ${res.status}`,
          })
        }
        track({
          kind: "share",
          text: `Indexing notification for ${batchDocs.length} ${
            batchDocs.length === 1 ? "document" : "documents"
          }`,
          detail: `${batch.email}${data.simulated ? " (simulated)" : ""}`,
        })
      })
      .catch(() => {
        toast.error("Notification email failed", {
          description: "Could not reach the notification service.",
        })
      })
  }, [])

  /** Upload: POST real files to Foundry, refresh, then poll indexing. */
  const start = async () => {
    setRunning(true)
    const realFiles = files.flatMap((f) =>
      f.file ? [{ file: f.file, name: f.name }] : []
    )
    if (realFiles.length === 0) {
      setRunning(false)
      toast.error("No files to upload")
      return
    }
    const targetFolderId =
      folderId !== ROOT_FOLDER && folders.some((f) => f.id === folderId)
        ? folderId
        : null
    try {
      await liveApi.uploadDocs(realFiles, targetFolderId)
      pushActivity({
        kind: "upload",
        text: `Uploaded ${realFiles.length} ${realFiles.length === 1 ? "file" : "files"}`,
        detail: "Indexing in progress",
      })
      toast.success("Uploaded", {
        description: "Indexing runs in the background; statuses refresh automatically.",
      })

      const { data } = await liveApi.docs()
      const mapped = data.map((d) => mapLiveDoc(d))
      useOrbit.setState((prev) => ({
        docs: mapped.map((doc) => {
          // keep any folder assignment the store already knew about
          const existing = prev.docs.find((d) => d.id === doc.id)
          return existing ? { ...doc, folderId: existing.folderId } : doc
        }),
      }))

      const batchIds = mapped.flatMap((d) =>
        realFiles.some((rf) => rf.name === d.name) ? [d.id] : []
      )
      batchRef.current = {
        ids: batchIds,
        email: notifyEmail.trim(),
        enabled: notifyEnabled && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail),
        notified: false,
      }
      const poll = setInterval(async () => {
        try {
          const statuses = await liveApi.docStatuses(batchIds)
          for (const s of statuses.data) {
            if (s.isIndexed) {
              updateDoc(s.primaryKey, {
                status: "ready",
                pages: s.noPages ?? undefined,
              })
            }
          }
          const allReady = batchIds.every(
            (id) =>
              useOrbit.getState().docs.find((d) => d.id === id)?.status === "ready"
          )
          if (allReady) {
            clearInterval(poll)
            maybeNotify()
          }
        } catch {
          /* retry next tick */
        }
      }, 15000)
      timers.current.push(poll as unknown as ReturnType<typeof setInterval>)
      // Upload is done; indexing continues in the background (tracked in the
      // library). Close the dialog so the user isn't blocked.
      setRunning(false)
      onOpenChange(false)
    } catch (error) {
      setRunning(false)
      const message = error instanceof Error ? error.message : "Upload failed"
      toast.error("Upload failed", { description: message })
    }
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
                PDF, Word, CSV, Markdown · up to 200 MB
              </p>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  queueRealFiles(Array.from(e.target.files ?? []))
                  e.target.value = ""
                }}
              />
            </div>
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
              <SelectItem value={ROOT_FOLDER}>Library (root)</SelectItem>
              {folders.flatMap((f) =>
                f.source === "upload"
                  ? [
                      <SelectItem key={f.id} value={f.id}>
                        {f.parentId ? "· " : ""}
                        {f.name}
                      </SelectItem>,
                    ]
                  : []
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Per-batch indexing notification (SendGrid) */}
        <div className="space-y-2.5 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Mail className="text-muted-foreground size-4" />
            <Label htmlFor="notify-toggle" className="flex-1 font-normal">
              Email me when this batch finishes indexing
            </Label>
            <Switch
              id="notify-toggle"
              checked={notifyEnabled}
              onCheckedChange={setNotifyEnabled}
              disabled={running}
            />
          </div>
          {notifyEnabled && (
            <div className="flex items-center gap-2 pl-6">
              <Input
                type="email"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                placeholder="you@jacobs.com"
                disabled={running}
                className="h-8 text-sm"
              />
              <span className="text-muted-foreground shrink-0 text-[10px]">
                via SendGrid
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void start()} disabled={files.length === 0 || running}>
            {running
              ? "Uploading…"
              : `Upload ${files.length > 0 ? files.length : ""} ${
                  files.length === 1 ? "file" : "files"
                }`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
