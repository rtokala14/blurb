"use client"

import * as React from "react"
import {
  ArrowUp,
  Briefcase,
  ClipboardCheck,
  ClipboardList,
  FilePlus2,
  FileText,
  FolderSearch,
  MessageSquareReply,
  Sparkles,
  Square,
  TrendingUp,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react"

import { DocIcon } from "@/components/doc-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DOC_SKILLS, type DocSkill } from "@/lib/docgen/skills"
import { useOrbit } from "@/lib/store"
import type { ChatSession } from "@/lib/types"

/** Skill icon name -> component (allow-listed in lib/docgen/skills). */
const SKILL_ICONS: Record<string, LucideIcon> = {
  "file-text": FileText,
  briefcase: Briefcase,
  "clipboard-list": ClipboardList,
  "message-square-reply": MessageSquareReply,
  "clipboard-check": ClipboardCheck,
  "trending-up": TrendingUp,
  trophy: Trophy,
  sparkles: Sparkles,
}

type ComposerProps = {
  session: ChatSession
  isBusy: boolean
  onSend: (text: string, opts?: { docSkillId?: string }) => void
  onStop: () => void
  onOpenContext: () => void
  contextOpen: boolean
  live?: boolean
}

function ComposerImpl({
  session,
  isBusy,
  onSend,
  onStop,
  onOpenContext,
  contextOpen,
  live = false,
}: ComposerProps) {
  const docs = useOrbit((s) => s.docs)
  const setSessionScope = useOrbit((s) => s.setSessionScope)
  const [value, setValue] = React.useState("")
  /** live mode: selected doc skill — the next send becomes a generation turn */
  const [pendingSkill, setPendingSkill] = React.useState<DocSkill | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const scopeIds = new Set(session.scopeDocIds)
  const scopeDocs = docs.filter((d) => scopeIds.has(d.id))
  const showSlash = value.startsWith("/") && !value.includes(" ")
  // "/" opens the document-type picker
  const skillQuery = value.slice(1).toLowerCase()
  const filteredSkills = DOC_SKILLS.filter(
    (s) =>
      !skillQuery ||
      s.name.toLowerCase().includes(skillQuery) ||
      s.id.includes(skillQuery) ||
      s.summary.toLowerCase().includes(skillQuery) ||
      "doc".startsWith(skillQuery)
  )

  const pickSkill = (skill: DocSkill) => {
    setPendingSkill(skill)
    setValue("")
    textareaRef.current?.focus()
  }

  const submit = () => {
    const text = value.trim()
    if (!text || isBusy) return
    onSend(text, pendingSkill ? { docSkillId: pendingSkill.id } : undefined)
    setValue("")
    setPendingSkill(null)
  }

  return (
    <div className="bg-background border-t">
      <div className="mx-auto max-w-4xl px-4 py-3">
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
              <button type="button"
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

        {/* Slash menu: document skill packs */}
        {showSlash && live && filteredSkills.length > 0 && (
          <div className="bg-popover mb-2 max-h-72 overflow-y-auto rounded-lg border shadow-md">
            <p className="text-muted-foreground/70 px-3 pt-2 pb-1 text-[10px] font-medium tracking-wide uppercase">
              Draft a document
            </p>
            {filteredSkills.map((skill) => {
              const Icon = SKILL_ICONS[skill.icon] ?? FileText
              return (
                <button type="button"
                  key={skill.id}
                  className="hover:bg-accent flex w-full items-center gap-3 px-3 py-2 text-left"
                  onClick={() => pickSkill(skill)}
                >
                  <Icon className="text-muted-foreground size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{skill.name}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {skill.summary}
                    </p>
                  </div>
                </button>
              )
            })}
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
              if (e.key === "Escape" && pendingSkill && !value.trim()) {
                setPendingSkill(null)
              }
            }}
            placeholder={
              pendingSkill
                ? `Describe what to draft — ${pendingSkill.briefPlaceholder}`
                : scopeDocs.length === 0
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
              <TooltipContent>Draft a document</TooltipContent>
            </Tooltip>
            {live && pendingSkill && (
              <Badge variant="secondary" className="h-7 gap-1.5 pr-1 pl-2 font-normal">
                {(() => {
                  const Icon = SKILL_ICONS[pendingSkill.icon] ?? FileText
                  return <Icon className="text-primary size-3.5" />
                })()}
                <span className="max-w-40 truncate text-xs">
                  Draft: {pendingSkill.name}
                </span>
                <button
                  type="button"
                  aria-label="Cancel document draft"
                  className="hover:bg-background/60 rounded-full p-0.5"
                  onClick={() => setPendingSkill(null)}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            )}
            <span className="text-muted-foreground ml-auto mr-2 text-[11px] max-sm:hidden">
              <Kbd>Enter</Kbd> send · <Kbd>Shift+Enter</Kbd> newline
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

/**
 * Memoized so the composer stops reconciling on every streamed token. The
 * parent re-renders per stream flush with a new `session` object, but the
 * composer only depends on a few of its fields — compare those explicitly
 * (callbacks are stable via the memoized chat controller).
 */
export const Composer = React.memo(ComposerImpl, (prev, next) => {
  return (
    prev.isBusy === next.isBusy &&
    prev.contextOpen === next.contextOpen &&
    prev.live === next.live &&
    prev.onSend === next.onSend &&
    prev.onStop === next.onStop &&
    prev.onOpenContext === next.onOpenContext &&
    prev.session.id === next.session.id &&
    prev.session.scopeDocIds === next.session.scopeDocIds
  )
})
