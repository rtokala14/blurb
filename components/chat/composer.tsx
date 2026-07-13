"use client"

import * as React from "react"
import {
  ArrowUp,
  Brain,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderSearch,
  Presentation,
  Square,
  X,
} from "lucide-react"

import { DocIcon } from "@/components/doc-icon"
import { PersonaChip } from "@/components/chat/persona-picker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useOrbit } from "@/lib/store"
import type { ChatSession } from "@/lib/types"

const slashCommands = [
  {
    command: "/doc",
    icon: FileText,
    label: "Draft a document",
    hint: "Brief, memo, report — grounded in scope",
  },
  {
    command: "/sheet",
    icon: FileSpreadsheet,
    label: "Build a spreadsheet",
    hint: "Model or tracker with sourced inputs",
  },
  {
    command: "/deck",
    icon: Presentation,
    label: "Create a presentation",
    hint: "Slides with speaker notes & citations",
  },
]

export function Composer({
  session,
  isBusy,
  onSend,
  onStop,
  onOpenContext,
  contextOpen,
  live = false,
}: {
  session: ChatSession
  isBusy: boolean
  onSend: (text: string) => void
  onStop: () => void
  onOpenContext: () => void
  contextOpen: boolean
  live?: boolean
}) {
  const docs = useOrbit((s) => s.docs)
  const setSessionScope = useOrbit((s) => s.setSessionScope)
  const [value, setValue] = React.useState("")
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const scopeDocs = docs.filter((d) => session.scopeDocIds.includes(d.id))
  const showSlash = value.startsWith("/") && !value.includes(" ")
  const filteredCommands = slashCommands.filter((c) =>
    c.command.startsWith(value.toLowerCase())
  )

  const submit = () => {
    const text = value.trim()
    if (!text || isBusy) return
    onSend(text)
    setValue("")
  }

  return (
    <div className="bg-background border-t">
      <div className="mx-auto max-w-3xl px-4 py-3">
        {/* Scope chips */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={contextOpen ? "secondary" : "outline"}
                size="sm"
                className="h-6.5 gap-1.5 px-2 text-xs"
                onClick={onOpenContext}
              >
                <FolderSearch className="size-3.5" />
                {scopeDocs.length === 0
                  ? "Select context"
                  : `${scopeDocs.length} in scope`}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Choose which documents ground this conversation
            </TooltipContent>
          </Tooltip>
          {scopeDocs.slice(0, 4).map((doc) => (
            <Badge
              key={doc.id}
              variant="secondary"
              className="max-w-48 gap-1 pr-1 font-normal"
            >
              <DocIcon type={doc.type} className="size-3" />
              <span className="truncate">{doc.name}</span>
              <button
                aria-label={`Remove ${doc.name} from scope`}
                className="hover:bg-muted-foreground/20 rounded-full p-0.5"
                onClick={() =>
                  setSessionScope(
                    session.id,
                    session.scopeDocIds.filter((id) => id !== doc.id)
                  )
                }
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          {scopeDocs.length > 4 && (
            <Badge
              variant="outline"
              className="cursor-pointer font-normal"
              onClick={onOpenContext}
            >
              +{scopeDocs.length - 4} more
            </Badge>
          )}
        </div>

        {/* Slash command menu */}
        {showSlash && filteredCommands.length > 0 && (
          <div className="bg-popover mb-2 overflow-hidden rounded-lg border shadow-md">
            {filteredCommands.map((cmd) => (
              <button
                key={cmd.command}
                className="hover:bg-accent flex w-full items-center gap-3 px-3 py-2 text-left"
                onClick={() => {
                  setValue(`${cmd.command} `)
                  textareaRef.current?.focus()
                }}
              >
                <cmd.icon className="text-muted-foreground size-4" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{cmd.label}</p>
                  <p className="text-muted-foreground text-xs">{cmd.hint}</p>
                </div>
                <Kbd>{cmd.command}</Kbd>
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="focus-within:ring-ring/50 bg-muted/40 relative rounded-xl border transition-shadow focus-within:ring-2">
          <Textarea
            id="chat-composer"
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={
              scopeDocs.length === 0
                ? "Select documents, then ask anything… (try “/” for creation commands)"
                : `Ask across ${scopeDocs.length} ${scopeDocs.length === 1 ? "document" : "documents"}, or type “/” to create something…`
            }
            className="max-h-48 min-h-[52px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center gap-1 px-2.5 pb-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Create with AI"
                  onClick={() => {
                    setValue("/")
                    textareaRef.current?.focus()
                  }}
                >
                  <FilePlus2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Create a doc, sheet, or deck</TooltipContent>
            </Tooltip>
            {live && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={session.mode === "thinking" ? "secondary" : "ghost"}
                    size="sm"
                    aria-label="Toggle thinking mode"
                    aria-pressed={session.mode === "thinking"}
                    className={
                      session.mode === "thinking"
                        ? "text-primary h-7 gap-1 px-2 text-xs font-medium"
                        : "text-muted-foreground h-7 gap-1 px-2 text-xs"
                    }
                    onClick={() =>
                      useOrbit.getState().patchSession(session.id, {
                        mode: session.mode === "thinking" ? "regular" : "thinking",
                      })
                    }
                  >
                    <Brain className="size-3.5" />
                    Think longer
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {session.mode === "thinking"
                    ? "Deep-research agent is on — slower, more thorough answers"
                    : "Route this chat to the deep-research agent"}
                </TooltipContent>
              </Tooltip>
            )}
            {live && <PersonaChip sessionId={session.id} />}
            <span className="text-muted-foreground ml-auto mr-2 text-[11px] max-sm:hidden">
              <Kbd>↵</Kbd> send · <Kbd>⇧↵</Kbd> newline
            </span>
            {isBusy ? (
              <Button
                size="icon-sm"
                variant="secondary"
                className="max-sm:ml-auto"
                aria-label="Stop generating"
                onClick={onStop}
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                className="max-sm:ml-auto"
                aria-label="Send message"
                disabled={!value.trim()}
                onClick={submit}
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
        <p className="text-muted-foreground mt-1.5 text-center text-[11px]">
          {live
            ? "Grounded in your selected documents via Foundry · verify citations before sharing externally"
            : "Answers are grounded in your selected documents · verify citations before sharing externally"}
        </p>
      </div>
    </div>
  )
}
