"use client"

import * as React from "react"
import {
  Check,
  ChevronDown,
  FileDown,
  FolderSearch,
  GitBranch,
  ListTree,
  PanelRight,
  PenSquare,
  PencilLine,
  Sparkles,
} from "lucide-react"

import { Composer } from "@/components/chat/composer"
import { DocumentsPanel } from "@/components/chat/documents-panel"
import { ExportDialog } from "@/components/chat/export-dialog"
import { isEditableTarget } from "@/components/keyboard-shortcuts"
import { Message } from "@/components/chat/message"
import { TurnsNavigator } from "@/components/chat/turns-navigator"
import { useChat } from "@/components/chat/use-chat"
import { StudioPanel } from "@/components/studio/studio-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { activePath, countBranches, useOrbit } from "@/lib/store"
import { useIsMobile } from "@/hooks/use-mobile"

const suggestions = [
  "Which vendors are up for renewal this quarter?",
  "What termination rights do we have in the Acme MSA?",
  "/doc Draft a renewal negotiation brief for Acme",
  "/deck Build a QBR deck from the Q3 forecast",
]

export function ChatWorkspace() {
  const sessions = useOrbit((s) => s.sessions)
  const activeSessionId = useOrbit((s) => s.activeSessionId)
  const setActiveSession = useOrbit((s) => s.setActiveSession)
  const createSession = useOrbit((s) => s.createSession)
  const renameSession = useOrbit((s) => s.renameSession)
  const openArtifactId = useOrbit((s) => s.openArtifactId)
  const setOpenArtifact = useOrbit((s) => s.setOpenArtifact)
  const artifacts = useOrbit((s) => s.artifacts)

  const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0]
  const openArtifact = artifacts.find((a) => a.id === openArtifactId) ?? null

  const isMobile = useIsMobile()
  const [contextOpen, setContextOpen] = React.useState(true)
  const [turnsOpen, setTurnsOpen] = React.useState(true)

  /* give the Studio room when an artifact opens */
  React.useEffect(() => {
    if (openArtifactId) setContextOpen(false)
  }, [openArtifactId])

  /* the documents panel becomes an off-canvas sheet on small screens */
  React.useEffect(() => {
    if (isMobile) setContextOpen(false)
  }, [isMobile])
  const [exportOpen, setExportOpen] = React.useState(false)
  const [renaming, setRenaming] = React.useState(false)
  const [titleDraft, setTitleDraft] = React.useState("")
  const [activeMessageId, setActiveMessageId] = React.useState<string | null>(null)

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const sim = useChat(session?.id ?? "")

  /* live sessions: lazily fetch the transcript when opened */
  const loadContent = sim.loadContent
  React.useEffect(() => {
    if (
      session?.live &&
      !session.contentLoaded &&
      !sim.isBusy &&
      loadContent
    ) {
      void loadContent(session.id)
    }
  }, [session?.id, session?.live, session?.contentLoaded, sim.isBusy, loadContent])

  const path = session ? activePath(session) : []
  const branches = session ? countBranches(session) : 1
  const streamingContent = path.find((m) => m.phase !== "done")

  /* auto-scroll while streaming if the user is near the bottom */
  const contentLength = streamingContent?.content.length ?? -1
  const thinkingLength = streamingContent?.thinking?.length ?? -1
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || contentLength < 0) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distance < 240) el.scrollTop = el.scrollHeight
  }, [contentLength, thinkingLength])

  /* track which turn is in view for the navigator */
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) {
          setActiveMessageId(visible[0].target.id.replace("msg-", ""))
        }
      },
      { root: el, rootMargin: "0px 0px -60% 0px" }
    )
    el.querySelectorAll("[id^='msg-']").forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [path.length, session?.id])

  /* chat hotkeys: Esc stop · ⌘⇧E export · ⌘. docs panel · ⌥↑/↓ turns ·
     type anywhere to focus the composer */
  const hotkeyState = React.useRef({ sim, session, activeMessageId })
  React.useEffect(() => {
    hotkeyState.current = { sim, session, activeMessageId }
  })
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { sim: s, session: current, activeMessageId: active } =
        hotkeyState.current
      const mod = e.metaKey || e.ctrlKey
      if (e.key === "Escape" && s.isBusy) {
        s.stop()
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault()
        setExportOpen(true)
        return
      }
      if (mod && !e.shiftKey && e.key === ".") {
        e.preventDefault()
        setContextOpen((v) => !v)
        return
      }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && current) {
        e.preventDefault()
        const turns = activePath(current).filter((m) => m.role === "user")
        if (turns.length === 0) return
        const fullPath = activePath(current)
        let index = turns.findIndex(
          (t) =>
            t.id === active ||
            fullPath.find((m) => m.parentId === t.id)?.id === active
        )
        if (index === -1) index = e.key === "ArrowUp" ? turns.length : -1
        const next =
          e.key === "ArrowUp"
            ? Math.max(0, index - 1)
            : Math.min(turns.length - 1, index + 1)
        document
          .getElementById(`msg-${turns[next].id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" })
        return
      }
      /* plain typing focuses the composer, ChatGPT-style */
      if (
        !isEditableTarget(e.target) &&
        !mod &&
        !e.altKey &&
        e.key.length === 1 &&
        e.key !== "?"
      ) {
        document.getElementById("chat-composer")?.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  if (!session) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PenSquare />
          </EmptyMedia>
          <EmptyTitle>No sessions yet</EmptyTitle>
          <EmptyDescription>Start a conversation with your library.</EmptyDescription>
        </EmptyHeader>
        <Button onClick={() => createSession()}>
          <PenSquare /> New session
        </Button>
      </Empty>
    )
  }

  const jumpTo = (messageId: string) => {
    document
      .getElementById(`msg-${messageId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div className="flex min-h-0 flex-1">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={openArtifact ? 55 : 100} minSize={35}>
          <div className="flex h-full min-h-0 flex-col">
            {/* Session header */}
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
              {renaming ? (
                <div className="flex items-center gap-1">
                  <Input
                    autoFocus
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && titleDraft.trim()) {
                        renameSession(session.id, titleDraft.trim())
                        setRenaming(false)
                      }
                      if (e.key === "Escape") setRenaming(false)
                    }}
                    className="h-7 w-64 text-sm"
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Save title"
                    onClick={() => {
                      if (titleDraft.trim()) renameSession(session.id, titleDraft.trim())
                      setRenaming(false)
                    }}
                  >
                    <Check />
                  </Button>
                </div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5 font-medium">
                      <span className="max-w-36 truncate sm:max-w-72">
                        {session.title}
                      </span>
                      <ChevronDown className="text-muted-foreground size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72">
                    <DropdownMenuLabel>Sessions</DropdownMenuLabel>
                    {sessions.slice(0, 8).map((s) => (
                      <DropdownMenuItem
                        key={s.id}
                        onClick={() => setActiveSession(s.id)}
                      >
                        <span className="truncate">{s.title}</span>
                        {s.id === session.id && <Check className="ml-auto" />}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => createSession(session.scopeDocIds)}>
                      <PenSquare /> New session (same scope)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setTitleDraft(session.title)
                        setRenaming(true)
                      }}
                    >
                      <PencilLine /> Rename
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {branches > 1 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="gap-1">
                      <GitBranch className="size-3" /> {branches}
                      <span className="max-sm:hidden">branches</span>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    Use the arrows next to a message to switch branches
                  </TooltipContent>
                </Tooltip>
              )}

              <div className="ml-auto flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="max-sm:hidden"
                      aria-label="Toggle turns navigator"
                      onClick={() => setTurnsOpen((v) => !v)}
                    >
                      <ListTree />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Turns navigator</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Export session"
                      onClick={() => setExportOpen(true)}
                    >
                      <FileDown />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Export session</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={contextOpen ? "secondary" : "ghost"}
                      size="icon-sm"
                      aria-label="Toggle documents panel"
                      onClick={() => setContextOpen((v) => !v)}
                    >
                      <PanelRight />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {contextOpen ? "Hide" : "Show"} documents panel
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Messages + turns rail */}
            <div className="relative flex min-h-0 flex-1">
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
                {path.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
                    <div className="text-center">
                      <div className="from-primary to-chart-1 text-primary-foreground mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm">
                        <Sparkles className="size-5" />
                      </div>
                      <h2 className="text-lg font-semibold">
                        Ask across your library
                      </h2>
                      <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm">
                        {session.scopeDocIds.length === 0
                          ? "First, choose which documents the assistant may read — then every answer carries verifiable citations."
                          : `${session.scopeDocIds.length} documents are in scope. Answers will cite exact pages.`}
                      </p>
                    </div>
                    {session.scopeDocIds.length === 0 && (
                      <Button onClick={() => setContextOpen(true)}>
                        <FolderSearch /> Select documents
                      </Button>
                    )}
                    <div className="grid w-full max-w-lg grid-cols-1 gap-2">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => sim.send(s)}
                          className="hover:bg-accent text-muted-foreground hover:text-foreground hover:border-ring/50 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
                    {path.map((message) => (
                      <Message
                        key={message.id}
                        session={session}
                        message={message}
                        onRegenerate={sim.regenerate}
                        onEditAndBranch={sim.editAndBranch}
                      />
                    ))}
                    <div className="h-4" />
                  </div>
                )}
              </div>
              {turnsOpen && path.length > 0 && (
                <TurnsNavigator
                  session={session}
                  activeMessageId={activeMessageId}
                  onJump={jumpTo}
                />
              )}
            </div>

            <Composer
              session={session}
              isBusy={sim.isBusy}
              onSend={sim.send}
              onStop={sim.stop}
              onOpenContext={() => setContextOpen((v) => !v)}
              contextOpen={contextOpen}
              live={sim.live}
            />
          </div>
        </ResizablePanel>

        {openArtifact && !isMobile && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={45} minSize={28}>
              <StudioPanel
                artifact={openArtifact}
                onClose={() => setOpenArtifact(null)}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* Studio takes over the screen on mobile */}
      {openArtifact && isMobile && (
        <div className="bg-background fixed inset-0 z-50">
          <StudioPanel
            artifact={openArtifact}
            onClose={() => setOpenArtifact(null)}
          />
        </div>
      )}

      {/* Documents panel: fixed aside on desktop, off-canvas sheet on mobile */}
      {isMobile ? (
        <Sheet open={contextOpen} onOpenChange={setContextOpen}>
          <SheetContent side="right" className="w-[88vw] gap-0 p-0 sm:max-w-sm">
            <SheetTitle className="sr-only">Documents</SheetTitle>
            <DocumentsPanel
              session={session}
              onClose={() => setContextOpen(false)}
            />
          </SheetContent>
        </Sheet>
      ) : (
        contextOpen && (
          <aside className="w-80 shrink-0">
            <DocumentsPanel
              session={session}
              onClose={() => setContextOpen(false)}
            />
          </aside>
        )
      )}

      <ExportDialog
        session={session}
        open={exportOpen}
        onOpenChange={setExportOpen}
      />
    </div>
  )
}
