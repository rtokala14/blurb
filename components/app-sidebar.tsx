"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Cable,
  Check,
  ShieldCheck,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  FolderMinus,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  PenSquare,
  Pin,
  Trash2,
} from "lucide-react"

import { prefetchSessionContent } from "@/lib/live-session"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  ChatFolderDialog,
  DeleteChatFolderDialog,
} from "@/components/chat-folder-dialogs"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { folderSwatchClass, moveSessionToFolder } from "@/hooks/use-chat-folders"
import { OrbitMark } from "@/components/orbit-mark"
import { useOrbit } from "@/lib/store"
import { cn } from "@/lib/utils"
import type { ChatFolder, ChatSession } from "@/lib/types"

const nav = [
  { title: "Chat", href: "/chat", icon: MessageSquareText },
  { title: "Documents", href: "/documents", icon: FolderOpen },
  { title: "Connections", href: "/connections", icon: Cable },
]

const byRecency = (a: ChatSession, b: ChatSession) => {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
  return b.updatedAt.localeCompare(a.updatedAt)
}

type FolderDialogState = {
  open: boolean
  folder: ChatFolder | null
  /** file this session into the folder once created */
  moveSessionId?: string
}

/** One session row — used both inside folders and in the recent list. */
function SessionItem({
  session,
  inFolder = false,
  isActive,
  setActiveSession,
  togglePinSession,
  deleteSession,
  chatFolders,
  setFolderDialog,
}: {
  session: ChatSession
  inFolder?: boolean
  isActive: (session: ChatSession) => boolean
  setActiveSession: (id: string) => void
  togglePinSession: (id: string) => void
  deleteSession: (id: string) => void
  chatFolders: ChatFolder[]
  setFolderDialog: React.Dispatch<React.SetStateAction<FolderDialogState>>
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive(session)}
        onClick={() => setActiveSession(session.id)}
        // warm the transcript on hover/focus so opening feels instant
        onMouseEnter={() => prefetchSessionContent(session.id)}
        onFocus={() => prefetchSessionContent(session.id)}
        className={cn(inFolder && "h-7 text-[13px]")}
      >
        <Link href="/chat" title={session.title}>
          {session.pinned ? (
            <Pin className="text-muted-foreground" />
          ) : (
            <MessageSquareText className="text-muted-foreground" />
          )}
          <span className="truncate">{session.title}</span>
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label="Session actions">
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-52">
          <DropdownMenuItem onClick={() => togglePinSession(session.id)}>
            <Pin />
            {session.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderOpen className="text-muted-foreground mr-2 size-4" />
              Move to folder
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              {chatFolders.map((folder) => (
                <DropdownMenuItem
                  key={folder.id}
                  onClick={() => void moveSessionToFolder(session.id, folder.id)}
                >
                  <span
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      folderSwatchClass(folder.color)
                    )}
                  />
                  <span className="truncate">{folder.name}</span>
                  {session.chatFolderId === folder.id && (
                    <Check className="ml-auto size-3.5" />
                  )}
                </DropdownMenuItem>
              ))}
              {chatFolders.length > 0 && <DropdownMenuSeparator />}
              {session.chatFolderId && (
                <DropdownMenuItem
                  onClick={() => void moveSessionToFolder(session.id, null)}
                >
                  <FolderMinus />
                  Remove from folder
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() =>
                  setFolderDialog({
                    open: true,
                    folder: null,
                    moveSessionId: session.id,
                  })
                }
              >
                <FolderPlus />
                New folder…
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => deleteSession(session.id)}
          >
            <Trash2 />
            Delete session
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

export function AppSidebar() {
  const pathname = usePathname()
  const sessions = useOrbit((s) => s.sessions)
  const isAdmin = useOrbit((s) => s.liveIsAdmin)
  const liveUserEmail = useOrbit((s) => s.liveUserEmail)
  // Identity comes from Foundry (config route); fallback while it resolves.
  const profileEmail = liveUserEmail || "rohit.tokala@jacobs.com"
  const profileName = React.useMemo(() => {
    const local = profileEmail.split("@", 1)[0] ?? ""
    const tokens = local.replace(/[_-]/g, ".").split(".").filter(Boolean)
    if (tokens.length === 0) return "User"
    return tokens
      .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
      .join(" ")
  }, [profileEmail])
  const profileInitials = React.useMemo(
    () =>
      profileName
        .split(/\s+/)
        .slice(0, 2)
        .map((t) => t.charAt(0).toUpperCase())
        .join("") || "U",
    [profileName]
  )
  const chatFolders = useOrbit((s) => s.chatFolders)
  const activeSessionId = useOrbit((s) => s.activeSessionId)
  const setActiveSession = useOrbit((s) => s.setActiveSession)
  const createSession = useOrbit((s) => s.createSession)
  const togglePinSession = useOrbit((s) => s.togglePinSession)
  const deleteSession = useOrbit((s) => s.deleteSession)

  const [folderDialog, setFolderDialog] = React.useState<FolderDialogState>({
    open: false,
    folder: null,
  })
  const [deleteDialog, setDeleteDialog] = React.useState<{
    open: boolean
    folder: ChatFolder | null
  }>({ open: false, folder: null })

  // Recompute the recency-sorted lists only when sessions/folders change, not
  // on the sidebar's own local state (dialogs, hover) — and not repeatedly for
  // the same store update.
  const unfiled = React.useMemo(
    () =>
      sessions
        .filter(
          (s) => !s.chatFolderId || !chatFolders.some((f) => f.id === s.chatFolderId)
        )
        .sort(byRecency)
        .slice(0, 6),
    [sessions, chatFolders]
  )

  const sessionsByFolder = React.useMemo(() => {
    const map = new Map<string, ChatSession[]>()
    for (const folder of chatFolders) {
      map.set(
        folder.id,
        sessions.filter((s) => s.chatFolderId === folder.id).sort(byRecency)
      )
    }
    return map
  }, [sessions, chatFolders])

  const isActive = (session: ChatSession) =>
    pathname.startsWith("/chat") && session.id === activeSessionId

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/chat">
                <div className="text-primary flex aspect-square size-8 items-center justify-center">
                  <OrbitMark title="Orbit Docs" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span
                    className="truncate font-bold"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    Orbit Docs
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    isActive={
                      item.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(item.href)
                    }
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip="Admin"
                    isActive={pathname.startsWith("/admin")}
                  >
                    <Link href="/admin">
                      <ShieldCheck />
                      <span>Admin</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Sessions</SidebarGroupLabel>
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarGroupAction
                aria-label="New session folder"
                className="right-8"
                onClick={() => setFolderDialog({ open: true, folder: null })}
              >
                <FolderPlus />
              </SidebarGroupAction>
            </TooltipTrigger>
            <TooltipContent side="right">New folder</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarGroupAction
                aria-label="New session"
                onClick={() => createSession()}
              >
                <PenSquare />
              </SidebarGroupAction>
            </TooltipTrigger>
            <TooltipContent side="right">New session</TooltipContent>
          </Tooltip>
          <SidebarGroupContent>
            <SidebarMenu>
              {chatFolders.map((folder) => {
                const members = sessionsByFolder.get(folder.id) ?? []
                return (
                  <Collapsible key={folder.id} defaultOpen={members.some(isActive)}>
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          className="group/folder"
                          aria-label={`Folder ${folder.name}`}
                        >
                          <ChevronRight className="text-muted-foreground size-3.5 shrink-0 transition-transform group-data-[state=open]/folder:rotate-90" />
                          <span
                            className={cn(
                              "size-2.5 shrink-0 rounded-full",
                              folderSwatchClass(folder.color)
                            )}
                          />
                          <span className="truncate font-medium">{folder.name}</span>
                          <span className="text-muted-foreground/70 ml-auto text-[10px] tabular-nums">
                            {members.length}
                          </span>
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <SidebarMenuAction
                            showOnHover
                            aria-label={`Folder actions for ${folder.name}`}
                          >
                            <MoreHorizontal />
                          </SidebarMenuAction>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start" className="w-44">
                          <DropdownMenuItem
                            onClick={() => setFolderDialog({ open: true, folder })}
                          >
                            <Pencil />
                            Edit folder
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteDialog({ open: true, folder })}
                          >
                            <Trash2 />
                            Delete folder
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <CollapsibleContent>
                        <SidebarMenuSub className="mr-0 pr-0">
                          {members.length === 0 ? (
                            <SidebarMenuSubItem>
                              <p className="text-muted-foreground/70 px-2 py-1 text-xs italic">
                                No chats yet
                              </p>
                            </SidebarMenuSubItem>
                          ) : (
                            members.map((session) => (
                              <SessionItem
                                key={session.id}
                                session={session}
                                inFolder
                                isActive={isActive}
                                setActiveSession={setActiveSession}
                                togglePinSession={togglePinSession}
                                deleteSession={deleteSession}
                                chatFolders={chatFolders}
                                setFolderDialog={setFolderDialog}
                              />
                            ))
                          )}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                )
              })}
              {unfiled.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={isActive}
                  setActiveSession={setActiveSession}
                  togglePinSession={togglePinSession}
                  deleteSession={deleteSession}
                  chatFolders={chatFolders}
                  setFolderDialog={setFolderDialog}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">
                      {profileInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{profileName}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {profileEmail}
                    </span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem asChild>
                  <Link href="/settings">Profile & preferences</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings">Workspace settings</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <ChatFolderDialog
        open={folderDialog.open}
        onOpenChange={(open) => setFolderDialog((prev) => ({ ...prev, open }))}
        folder={folderDialog.folder}
        onCreated={(created) => {
          if (folderDialog.moveSessionId) {
            void moveSessionToFolder(folderDialog.moveSessionId, created.id)
          }
        }}
      />
      <DeleteChatFolderDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}
        folder={deleteDialog.folder}
      />
    </Sidebar>
  )
}
