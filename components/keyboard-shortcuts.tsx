"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { useOrbit } from "@/lib/store"
import { isEditableTarget } from "@/components/keyboard-shortcuts-utils"

/** Anywhere in the app can request the shortcuts dialog via this event. */
export const SHORTCUTS_EVENT = "orbit:show-shortcuts"

const nav: [string, string][] = [
  ["/chat", "Chat"],
  ["/documents", "Documents"],
  ["/connections", "Connections"],
]

interface ShortcutRow {
  keys: string[]
  label: string
}

const groups: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: "Global",
    rows: [
      { keys: ["Ctrl", "K"], label: "Command palette" },
      { keys: ["Ctrl", "B"], label: "Toggle navigation sidebar" },
      { keys: ["Ctrl", "1"], label: "Go to Chat (…Ctrl 3 for Connections)" },
      { keys: ["Ctrl", "Shift", "O"], label: "New chat session" },
      { keys: ["Ctrl", "Shift", "U"], label: "Upload documents" },
      { keys: ["?"], label: "Show this dialog" },
    ],
  },
  {
    title: "Chat",
    rows: [
      { keys: ["↵"], label: "Send message" },
      { keys: ["⇧", "↵"], label: "New line" },
      { keys: ["/"], label: "Creation command (/doc)" },
      { keys: ["Esc"], label: "Stop generating" },
      { keys: ["Ctrl", "."], label: "Toggle documents panel" },
      { keys: ["Ctrl", "Shift", "E"], label: "Export session" },
      { keys: ["Alt", "↑ ↓"], label: "Jump between turns" },
      { keys: ["A…Z"], label: "Start typing to focus the composer" },
    ],
  },
  {
    title: "Documents",
    rows: [
      { keys: ["Ctrl", "K"], label: "Search documents from anywhere" },
      { keys: ["→ click"], label: "Right-click a row for quick actions" },
    ],
  },
]

export function KeyboardShortcuts() {
  const router = useRouter()
  const createSession = useOrbit((s) => s.createSession)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(SHORTCUTS_EVENT, show)

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey

      /* ⌘1–⌘4 — page navigation */
      if (mod && !e.shiftKey && !e.altKey && /^[1-3]$/.test(e.key)) {
        e.preventDefault()
        router.push(nav[Number(e.key) - 1][0])
        return
      }
      /* ⌘⇧O — new session */
      if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault()
        createSession()
        router.push("/chat")
        return
      }
      /* ⌘⇧U — upload */
      if (mod && e.shiftKey && e.key.toLowerCase() === "u") {
        e.preventDefault()
        router.push("/documents?upload=1")
        return
      }
      /* ? — help (only outside editable fields) */
      if (e.key === "?" && !mod && !isEditableTarget(e.target)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener(SHORTCUTS_EVENT, show)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [router, createSession])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts across the Orbit Docs workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          {groups.map((group) => (
            <div key={group.title} className={group.title === "Global" ? "sm:row-span-2" : ""}>
              <h4 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                {group.title}
              </h4>
              <ul className="space-y-1.5">
                {group.rows.map((row) => (
                  <li
                    key={row.label}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-muted-foreground min-w-0 flex-1">
                      {row.label}
                    </span>
                    <KbdGroup className="shrink-0">
                      {row.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </KbdGroup>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
