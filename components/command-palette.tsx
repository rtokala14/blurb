"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  Cable,
  FolderOpen,
  Keyboard,
  MessageSquareText,
  Moon,
  PenSquare,
  RefreshCw,
  Settings,
  Sun,
  Upload,
} from "lucide-react"
import { useTheme } from "next-themes"

import { DocIcon } from "@/components/doc-icon"
import { adoptSearchResult, useLiveDocSearch } from "@/hooks/use-live-doc-search"
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

  const [search, setSearch] = React.useState("")
  // Corpus-wide matches from Foundry (live mode) — the local store only
  // holds the newest page of documents.
  const { results: serverHits } = useLiveDocSearch(search)

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
      <CommandInput
        placeholder="Search documents, sessions, actions…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => createSession())}>
            <PenSquare />
            New chat session
            <CommandShortcut>Ctrl+Shift+O</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => router.push("/documents?upload=1"))}
          >
            <Upload />
            Upload documents
            <CommandShortcut>Ctrl+Shift+U</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => router.push("/connections?sync=1"))}
          >
            <RefreshCw />
            Sync SharePoint now
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => window.dispatchEvent(new CustomEvent("orbit:show-shortcuts")))
            }
          >
            <Keyboard />
            Keyboard shortcuts
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => run(() => router.push("/chat"))}>
            <MessageSquareText />
            Chat
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/documents"))}>
            <FolderOpen />
            Documents
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/connections"))}>
            <Cable />
            Connections
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/settings"))}>
            <Settings />
            Settings
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
        {serverHits.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="All documents (Foundry)">
              {serverHits.slice(0, 8).map((doc) => (
                <CommandItem
                  key={doc.id}
                  // include the raw query so cmdk's client filter keeps
                  // these async results visible
                  value={`docsearch ${search} ${doc.name}`}
                  onSelect={() =>
                    run(() => {
                      adoptSearchResult(doc)
                      router.push(`/documents?doc=${doc.id}`)
                    })
                  }
                >
                  <DocIcon type={doc.type} />
                  <span className="truncate">{doc.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
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
