"use client"

import * as React from "react"
import {
  Check,
  Copy,
  Download,
  FileSearch,
  FileText,
  FileType2,
  Mail,
  Orbit,
  PencilLine,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react"
import { toast } from "sonner"

import { DocIcon } from "@/components/doc-icon"
import { ArtifactCard } from "@/components/chat/artifact-card"
import { BranchSwitcher } from "@/components/chat/branch-switcher"
import { CitationChip } from "@/components/chat/citation-chip"
import { EmailDialog } from "@/components/chat/email-dialog"
import { MessageContent } from "@/components/chat/message-content"
import { ThinkingIndicator } from "@/components/chat/thinking-indicator"
import { LivePdfDialog } from "@/components/live-pdf-dialog"
import { PdfViewerDialog } from "@/components/pdf-viewer-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { downloadMessage, type ExportFormat } from "@/lib/export-message"
import { useOrbit } from "@/lib/store"
import type { ChatMessage, ChatSession, Citation } from "@/lib/types"

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground size-7"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function MessageImpl({
  session,
  message,
  onRegenerate,
  onEditAndBranch,
}: {
  session: ChatSession
  message: ChatMessage
  onRegenerate: (message: ChatMessage) => void
  onEditAndBranch: (message: ChatMessage, newText: string) => void
}) {
  const docs = useOrbit((s) => s.docs)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(message.content)
  const [copied, setCopied] = React.useState(false)
  const [emailOpen, setEmailOpen] = React.useState(false)
  const [openCitation, setOpenCitation] = React.useState<Citation | null>(null)
  const [vote, setVote] = React.useState<"up" | "down" | null>(null)
  const [includeRefs, setIncludeRefs] = React.useState(true)

  const download = async (format: ExportFormat) => {
    try {
      const name = await downloadMessage(
        format,
        message,
        docs,
        session.title,
        includeRefs
      )
      toast.success("Downloaded", {
        description: `${name}${includeRefs ? " · with references" : " · without references"}`,
      })
    } catch {
      toast.error("Download failed")
    }
  }

  const copy = () => {
    navigator.clipboard
      ?.writeText(message.content.replace(/⟦(\d+)⟧/g, "[$1]"))
      .catch(() => undefined)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  /* ------------------------------- user ------------------------------- */
  if (message.role === "user") {
    return (
      <div id={`msg-${message.id}`} className="group flex flex-col items-end">
        {editing ? (
          <div className="w-full max-w-[85%] space-y-2">
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-20"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false)
                  setDraft(message.content)
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!draft.trim() || draft.trim() === message.content}
                onClick={() => {
                  setEditing(false)
                  onEditAndBranch(message, draft.trim())
                }}
              >
                Send & branch
              </Button>
            </div>
            <p className="text-muted-foreground text-right text-xs">
              Editing creates a new branch — the current reply is preserved.
            </p>
          </div>
        ) : (
          <>
            <div
              className={cn(
                "bg-primary text-primary-foreground max-w-[85%] rounded-xl rounded-br-sm px-4 py-2.5 transition-opacity",
                message.phase === "sending" && "opacity-70"
              )}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {message.content}
              </p>
            </div>
            <div className="mt-1 flex h-7 items-center gap-1">
              {message.phase === "sending" && (
                <span className="text-muted-foreground mr-1 flex items-center gap-1 text-xs">
                  <span className="bg-primary size-1.5 animate-pulse rounded-full" />
                  Sending…
                </span>
              )}
              <span className="text-muted-foreground mr-1 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
                {message.scopeLabel}
                {message.editedFrom && " · edited"}
              </span>
              <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
                <ActionButton label="Copy" onClick={copy}>
                  {copied ? <Check /> : <Copy />}
                </ActionButton>
              </div>
              <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
                <ActionButton
                  label="Edit & branch"
                  onClick={() => {
                    setDraft(message.content)
                    setEditing(true)
                  }}
                >
                  <PencilLine />
                </ActionButton>
              </div>
              <BranchSwitcher session={session} message={message} />
            </div>
          </>
        )}
      </div>
    )
  }

  /* ----------------------------- assistant ----------------------------- */
  const citations = message.citations ?? []
  const hasCitations = citations.length > 0

  return (
    <div id={`msg-${message.id}`} className="group flex gap-3">
      <div className="border-primary/20 bg-primary/5 flex size-7 shrink-0 items-center justify-center rounded-full border">
        <Orbit className="text-primary size-3.5" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <ThinkingIndicator message={message} />

        {(message.phase === "streaming" || message.phase === "done") &&
          message.content && (
            <MessageContent
              content={message.content}
              citations={message.citations}
              streaming={message.phase === "streaming"}
              renderCitation={(citation) => (
                <CitationChip citation={citation} onOpen={setOpenCitation} />
              )}
            />
          )}

        {message.artifactIds?.map((id) => (
          <ArtifactCard key={id} artifactId={id} />
        ))}

        {/* Sources strip */}
        {message.phase === "done" && hasCitations && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <FileSearch className="size-3" /> Sources:
            </span>
            {citations.map((c) => {
              const doc = docs.find((d) => d.id === c.docId)
              const name = doc?.name ?? c.docName
              if (!name) return null
              return (
                <Badge
                  key={c.n}
                  variant="outline"
                  className="hover:bg-muted max-w-64 cursor-pointer gap-1 font-normal"
                  onClick={() => setOpenCitation(c)}
                >
                  <span className="bg-primary/10 text-primary flex size-3.5 items-center justify-center rounded-full text-[9px] font-semibold">
                    {c.n}
                  </span>
                  {doc && <DocIcon type={doc.type} className="size-3" />}
                  <span className="truncate">{name}</span>
                  <span className="text-muted-foreground">
                    p.{c.pagesLabel ?? c.page}
                  </span>
                </Badge>
              )
            })}
          </div>
        )}

        {/* Actions */}
        {message.phase === "done" && (
          <div className="mt-2 flex h-7 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100 has-[button[data-state=open]]:opacity-100">
            <ActionButton label={copied ? "Copied" : "Copy"} onClick={copy}>
              {copied ? <Check /> : <Copy />}
            </ActionButton>
            <ActionButton
              label="Good response"
              onClick={() => {
                setVote(vote === "up" ? null : "up")
                if (vote !== "up") toast("Thanks — feedback recorded")
              }}
            >
              <ThumbsUp className={cn(vote === "up" && "fill-current")} />
            </ActionButton>
            <ActionButton
              label="Poor response"
              onClick={() => {
                setVote(vote === "down" ? null : "down")
                if (vote !== "down") toast("Thanks — we'll use this to improve")
              }}
            >
              <ThumbsDown className={cn(vote === "down" && "fill-current")} />
            </ActionButton>
            <ActionButton label="Regenerate (new branch)" onClick={() => onRegenerate(message)}>
              <RefreshCw />
            </ActionButton>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground size-7"
                      aria-label="Download response"
                    >
                      <Download />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Download response</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Download as</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => download("md")}>
                  <FileText /> Markdown (.md)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => download("pdf")}>
                  <FileType2 /> PDF (.pdf)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => download("docx")}>
                  <FileText /> Word (.docx)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={includeRefs}
                  onCheckedChange={(v) => setIncludeRefs(v === true)}
                  onSelect={(e) => e.preventDefault()}
                >
                  Include references
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ActionButton label="Refine & send as email" onClick={() => setEmailOpen(true)}>
              <Mail />
            </ActionButton>
            <BranchSwitcher session={session} message={message} />
          </div>
        )}
      </div>

      <EmailDialog
        message={message}
        session={session}
        open={emailOpen}
        onOpenChange={setEmailOpen}
      />
      {openCitation?.mediaRid ? (
        <LivePdfDialog
          citation={openCitation}
          open={openCitation !== null}
          onOpenChange={(open) => !open && setOpenCitation(null)}
        />
      ) : (
        <PdfViewerDialog
          doc={
            openCitation
              ? (docs.find((d) => d.id === openCitation.docId) ?? null)
              : null
          }
          page={openCitation?.page}
          quote={openCitation?.quote}
          citationLabel={openCitation ? `Citation ${openCitation.n}` : undefined}
          open={openCitation !== null}
          onOpenChange={(open) => !open && setOpenCitation(null)}
        />
      )}
    </div>
  )
}

/**
 * Memoized: during streaming the store replaces the sessions array on every
 * chunk, which would re-render (and re-parse the markdown of) EVERY message
 * in the transcript. Only the message whose object identity changed — plus
 * structural session changes that affect the branch switcher — re-render.
 */
export const Message = React.memo(MessageImpl, (prev, next) => {
  return (
    prev.message === next.message &&
    prev.session.id === next.session.id &&
    prev.session.leafId === next.session.leafId &&
    prev.session.activeBranchId === next.session.activeBranchId &&
    prev.session.branches === next.session.branches &&
    Object.keys(prev.session.messages).length ===
      Object.keys(next.session.messages).length
  )
})
