"use client"

import * as React from "react"
import { Crown, Loader2, Plus, UserRound, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Share management for folders and sync sources: a normalized email list
 * with add/remove, saved in one action. All comparisons are lowercase —
 * emails are case-insensitive everywhere in the app.
 */
export function ShareDialog({
  open,
  onOpenChange,
  title,
  description,
  ownerEmail,
  emails,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** shown as a locked entry; never part of the editable list */
  ownerEmail?: string | null
  emails: string[]
  onSave: (emails: string[]) => Promise<void>
}) {
  const [list, setList] = React.useState<string[]>([])
  const [draft, setDraft] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const [prevOpen, setPrevOpen] = React.useState(open)
  const [prevEmails, setPrevEmails] = React.useState(emails)
  if (open !== prevOpen || emails !== prevEmails) {
    setPrevOpen(open)
    setPrevEmails(emails)
    if (open) {
      setList([
        ...new Set(
          emails.flatMap((e) => {
            const email = e.trim().toLowerCase()
            return email ? [email] : []
          })
        ),
      ])
      setDraft("")
    }
  }

  const owner = (ownerEmail ?? "").trim().toLowerCase()

  const add = () => {
    const email = draft.trim().toLowerCase()
    if (!email) return
    if (!EMAIL_RE.test(email)) {
      toast.error("That doesn't look like an email address")
      return
    }
    if (email === owner) {
      toast("The owner always has access")
      setDraft("")
      return
    }
    if (list.includes(email)) {
      toast("Already in the list")
      setDraft("")
      return
    }
    setList((prev) => [...prev, email])
    setDraft("")
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(list)
      onOpenChange(false)
    } catch (error) {
      toast.error("Couldn't update sharing", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            autoFocus
            placeholder="name.surname@jacobs.com"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
          />
          <Button variant="outline" onClick={add} disabled={!draft.trim()}>
            <Plus /> Add
          </Button>
        </div>

        <div className="max-h-56 space-y-1.5 overflow-y-auto">
          {owner && (
            <div className="bg-muted/50 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
              <Crown className="size-3.5 shrink-0 text-amber-500" />
              <span className="min-w-0 flex-1 truncate">{owner}</span>
              <Badge variant="outline" className="text-[10px]">
                Owner
              </Badge>
            </div>
          )}
          {list.length === 0 ? (
            <p className="text-muted-foreground px-1 py-2 text-sm">
              Not shared with anyone yet — add a colleague's email above.
            </p>
          ) : (
            list.map((email) => (
              <div
                key={email}
                className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
              >
                <UserRound className="text-muted-foreground size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{email}</span>
                <button type="button"
                  aria-label={`Remove ${email}`}
                  className="hover:bg-muted-foreground/20 rounded-full p-0.5"
                  onClick={() => setList((prev) => prev.filter((e) => e !== email))}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="animate-spin" /> Saving…
              </>
            ) : (
              "Save sharing"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
