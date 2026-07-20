"use client"

import * as React from "react"
import { CheckCircle2, Mail, Sparkles } from "lucide-react"
import { toast } from "sonner"

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import { buildMailto, markdownToPlainText } from "@/lib/format"
import { liveApi } from "@/lib/live-api"
import { cn } from "@/lib/utils"
import { useOrbit } from "@/lib/store"
import type { ChatMessage, ChatSession } from "@/lib/types"

type Tone = "formal" | "neutral" | "friendly"
type Length = "brief" | "detailed"

function draftEmail(
  message: ChatMessage,
  session: ChatSession,
  tone: Tone,
  length: Length,
  docNames: string[]
): string {
  const cleaned = message.content
    .replace(/⟦(\d+)⟧/g, (_, n) => `[${n}]`)
    .replace(/\*\*/g, "")
    .replace(/^> /gm, "")

  const greeting =
    tone === "formal" ? "Dear team," : tone === "friendly" ? "Hi all! 👋" : "Hi team,"
  const opener =
    tone === "formal"
      ? `Please find below a summary prepared from our document workspace regarding “${session.title}”.`
      : `Sharing the key findings from our analysis of “${session.title}”.`
  const body =
    length === "brief"
      ? cleaned.split("\n\n").slice(0, 2).join("\n\n")
      : cleaned
  const sources =
    docNames.length > 0
      ? `\n\nSources referenced:\n${docNames.map((n, i) => `  [${i + 1}] ${n}`).join("\n")}`
      : ""
  const signoff =
    tone === "formal"
      ? "Kind regards,\nRohit Tokala"
      : tone === "friendly"
        ? "Thanks!\nRohit"
        : "Best,\nRohit"

  return `${greeting}\n\n${opener}\n\n${body}${sources}\n\n${signoff}`
}

export function EmailDialog({
  message,
  session,
  open,
  onOpenChange,
}: {
  message: ChatMessage
  session: ChatSession
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const docs = useOrbit((s) => s.docs)
  const pushActivity = useOrbit((s) => s.pushActivity)

  const citedDocNames = React.useMemo(
    () =>
      (message.citations ?? [])
        .map((c) => docs.find((d) => d.id === c.docId)?.name)
        .filter((n): n is string => !!n)
        .filter((n, i, arr) => arr.indexOf(n) === i),
    [message.citations, docs]
  )

  const [to, setTo] = React.useState("legal@jacobs.com")
  const [cc, setCc] = React.useState("")
  const [subject, setSubject] = React.useState(`Summary: ${session.title}`)
  const [tone, setTone] = React.useState<Tone>("neutral")
  const [length, setLength] = React.useState<Length>("detailed")
  const [body, setBody] = React.useState("")
  const [refining, setRefining] = React.useState(false)
  const [state, setState] = React.useState<"editing" | "sending" | "sent">("editing")
  const timers = React.useRef<ReturnType<typeof setInterval | typeof setTimeout>[]>([])

  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setBody(draftEmail(message, session, tone, length, citedDocNames))
      setState("editing")
    }
  }

  React.useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
  }, [])

  /**
   * Re-draft with current tone/length. Live mode routes through the real
   * Foundry refining agent; demo mode keeps the local template with a
   * simulated stream.
   */
  const refine = async () => {
    setRefining(true)
    if (useOrbit.getState().live === true) {
      try {
        const { text } = await liveApi.refine({
          // Email refining doesn't need doc grounding/citations — route it
          // through the fast, model-flexible LLM proxy instead of the AIP query.
          engine: "llm-proxy",
          userInput: message.content,
          toRefine: body || draftEmail(message, session, tone, length, citedDocNames),
          refineRequest:
            `Rewrite this as a ${tone} business email that is ` +
            (length === "brief"
              ? "brief — two short paragraphs at most."
              : "appropriately detailed.") +
            " Keep any citation markers like [1] intact and end with a professional sign-off. Return only the email body.",
        })
        if (text?.trim()) setBody(text.trim())
      } catch (error) {
        toast.error("Couldn't refine the draft", {
          description: error instanceof Error ? error.message : undefined,
        })
      } finally {
        setRefining(false)
      }
      return
    }
    const target = draftEmail(message, session, tone, length, citedDocNames)
    setBody("")
    const tokens = target.match(/\S+\s*/g) ?? []
    let cursor = 0
    const interval = setInterval(() => {
      cursor = Math.min(tokens.length, cursor + 4)
      setBody(tokens.slice(0, cursor).join(""))
      if (cursor >= tokens.length) {
        clearInterval(interval)
        setRefining(false)
      }
    }, 24)
    timers.current.push(interval)
  }

  /**
   * Hand off to the user's mail client (Outlook desktop, Outlook web handler,
   * Apple Mail, …) via a `mailto:` link with the draft prefilled. The body is
   * flattened to plain text since mailto bodies don't render markdown.
   */
  const send = () => {
    const href = buildMailto({
      to,
      cc,
      subject,
      body: markdownToPlainText(body),
    })
    // mailto: URLs can get long; most clients accept several thousand chars,
    // but warn (and still try) if we're well past the safe window.
    if (href.length > 8000) {
      toast.warning("Draft is long", {
        description:
          "Some mail clients truncate very long messages — trim if needed.",
      })
    }
    setState("sending")
    // Navigating the top window to a mailto: opens the OS mail handler without
    // leaving the app (no blank tab, unlike window.open).
    window.location.href = href
    pushActivity({
      kind: "share",
      text: `Opened email draft to ${to}`,
      detail: subject,
    })
    timers.current.push(
      setTimeout(() => {
        setState("sent")
        toast.success("Draft opened in your mail app", {
          description: `${subject} → ${to}`,
        })
        timers.current.push(setTimeout(() => onOpenChange(false), 1200))
      }, 400)
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Refine & send as email</DialogTitle>
          <DialogDescription>
            Turn this response into a polished email, then open it in Outlook to
            review and send. The AI rewrites for your chosen tone.
          </DialogDescription>
        </DialogHeader>

        {state === "sent" ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="size-10 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-medium">Opened in your mail app</p>
            <p className="text-muted-foreground text-xs">
              Review and send from Outlook to finish.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="email-to">To</Label>
                <Input
                  id="email-to"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="name@company.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email-cc">Cc</Label>
                <Input
                  id="email-cc"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="optional"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="email-subject">Subject</Label>
                <Input
                  id="email-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>Tone</Label>
                <Select value={tone} onValueChange={(v) => setTone(v as Tone)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="formal">Formal</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                    <SelectItem value="friendly">Friendly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Length</Label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={length}
                  onValueChange={(v) => v && setLength(v as Length)}
                >
                  <ToggleGroupItem value="brief" className="px-3">
                    Brief
                  </ToggleGroupItem>
                  <ToggleGroupItem value="detailed" className="px-3">
                    Detailed
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <Button
                variant="secondary"
                className="ml-auto"
                onClick={refine}
                disabled={refining}
              >
                {refining ? <Spinner /> : <Sparkles />}
                {refining ? "Rewriting…" : "Refine with AI"}
              </Button>
            </div>

            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={cn(
                "max-h-72 min-h-56 font-mono text-xs leading-relaxed",
                refining && "streaming-caret"
              )}
              readOnly={refining}
            />

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={send} disabled={state === "sending" || refining || !to}>
                {state === "sending" ? <Spinner /> : <Mail />}
                {state === "sending" ? "Opening…" : "Open in Outlook"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
