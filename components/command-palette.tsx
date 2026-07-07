"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  Cable,
  FolderOpen,
  LayoutDashboard,
  MessageSquareText,
  Moon,
  PenSquare,
  RefreshCw,
  Sparkles,
  Sun,
  Upload,
} from "lucide-react"
import { useTheme } from "next-themes"

import { DocIcon } from "@/components/doc-icon"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { useOrbit } from "@/lib/store"

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { setTheme } = useTheme()
  const docs = useOrbit((s) => s.docs)
  const sessions = useOrbit((s) => s.sessions)
  const setActiveSession = useOrbit((s) => s.setActiveSession)
  const createSession = useOrbit((s) => s.createSession)

  const run = React.useCallback(
    (fn: () => void) => {
      onOpenChange(false)
      fn()
    },
    [onOpenChange]
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search documents, sessions, and actions"
    >
      <CommandInput placeholder="Search documents, sessions, actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => createSession())}>
            <PenSquare />
            New chat session
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => router.push("/documents?upload=1"))}
          >
            <Upload />
            Upload documents
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => router.push("/connections?sync=1"))}
          >
            <RefreshCw />
            Sync SharePoint now
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => run(() => router.push("/"))}>
            <LayoutDashboard />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/chat"))}>
            <MessageSquareText />
            Chat
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/documents"))}>
            <FolderOpen />
            Documents
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/studio"))}>
            <Sparkles />
            Studio
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/connections"))}>
            <Cable />
            Connections
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Sessions">
          {sessions.slice(0, 5).map((session) => (
            <CommandItem
              key={session.id}
              value={`session ${session.title}`}
              onSelect={() =>
                run(() => {
                  setActiveSession(session.id)
                  router.push("/chat")
                })
              }
            >
              <MessageSquareText />
              {session.title}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Documents">
          {docs.slice(0, 8).map((doc) => (
            <CommandItem
              key={doc.id}
              value={`doc ${doc.name} ${doc.tags.join(" ")}`}
              onSelect={() =>
                run(() => router.push(`/documents?doc=${doc.id}`))
              }
            >
              <DocIcon type={doc.type} />
              <span className="truncate">{doc.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem onSelect={() => run(() => setTheme("light"))}>
            <Sun />
            Light mode
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("dark"))}>
            <Moon />
            Dark mode
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
