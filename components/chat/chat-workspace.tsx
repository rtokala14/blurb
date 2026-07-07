"use client"

import * as React from "react"
import {
  Check,
  ChevronDown,
  FileDown,
  FolderSearch,
  GitBranch,
  ListTree,
  PanelLeftClose,
  PenSquare,
  PencilLine,
  Sparkles,
} from "lucide-react"

import { Composer } from "@/components/chat/composer"
import { ContextPanel } from "@/components/chat/context-panel"
import { ExportDialog } from "@/components/chat/export-dialog"
import { Message } from "@/components/chat/message"
import { TurnsNavigator } from "@/components/chat/turns-navigator"
import { useChatSimulation } from "@/components/chat/use-chat-simulation"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { activePath, countBranches, useOrbit } from "@/lib/store"

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

  const [contextOpen, setContextOpen] = React.useState(false)
  const [turnsOpen, setTurnsOpen] = React.useState(true)
  const [exportOpen, setExportOpen] = React.useState(false)
  const [renaming, setRenaming] = React.useState(false)
  const [titleDraft, setTitleDraft] = React.useState("")
  const [activeMessageId, setActiveMessageId] = React.useState<string | null>(null)

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const sim = useChatSimulation(session?.id ?? "")

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
      {/* Context scope panel */}
      {contextOpen && (
        <aside className="w-80 shrink-0 border-r">
          <ContextPanel session={session} onClose={() => setContextOpen(false)} />
        </aside>
      )}

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={openArtifact ? 55 : 100} minSize={35}>
          <div className="flex h-full min-h-0 flex-col">
            {/* Session header */}
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Toggle context panel"
                    onClick={() => setContextOpen((v) => !v)}
                  >
                    {contextOpen ? <PanelLeftClose /> : <FolderSearch />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {contextOpen ? "Hide" : "Show"} context scope
                </TooltipContent>
              </Tooltip>

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
                      <span className="max-w-72 truncate">{session.title}</span>
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
                      <GitBranch className="size-3" /> {branches} branches
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
              </div>
            </div>

            {/* Messages + turns rail */}
            <div className="flex min-h-0 flex-1">
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
                {path.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
                    <div className="text-center">
                      <div className="bg-primary/5 border-primary/20 mx-auto mb-4 flex size-12 items-center justify-center rounded-full border">
                        <Sparkles className="text-primary size-5" />
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
                          className="hover:bg-accent text-muted-foreground hover:text-foreground rounded-lg border px-3 py-2 text-left text-sm transition-colors"
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
            />
          </div>
        </ResizablePanel>

        {openArtifact && (
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

      <ExportDialog
        session={session}
        open={exportOpen}
        onOpenChange={setExportOpen}
      />
    </div>
  )
}
