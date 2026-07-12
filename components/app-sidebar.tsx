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
  LayoutDashboard,
  MessageSquareText,
  MoreHorizontal,
  Orbit,
  Pencil,
  PenSquare,
  Pin,
  Sparkles,
  Trash2,
} from "lucide-react"

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
import { useOrbit } from "@/lib/store"
import { cn } from "@/lib/utils"
import type { ChatFolder, ChatSession } from "@/lib/types"

const nav = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Chat", href: "/chat", icon: MessageSquareText },
  { title: "Documents", href: "/documents", icon: FolderOpen },
  { title: "Studio", href: "/studio", icon: Sparkles },
  { title: "Connections", href: "/connections", icon: Cable },
]

const byRecency = (a: ChatSession, b: ChatSession) => {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
  return b.updatedAt.localeCompare(a.updatedAt)
}

export function AppSidebar() {
  const pathname = usePathname()
  const sessions = useOrbit((s) => s.sessions)
  const isAdmin = useOrbit((s) => s.liveIsAdmin)
  const chatFolders = useOrbit((s) => s.chatFolders)
  const live = useOrbit((s) => s.live === true)
  const activeSessionId = useOrbit((s) => s.activeSessionId)
  const setActiveSession = useOrbit((s) => s.setActiveSession)
  const createSession = useOrbit((s) => s.createSession)
  const togglePinSession = useOrbit((s) => s.togglePinSession)
  const deleteSession = useOrbit((s) => s.deleteSession)

  const [folderDialog, setFolderDialog] = React.useState<{
    open: boolean
    folder: ChatFolder | null
    /** file this session into the folder once created */
    moveSessionId?: string
  }>({ open: false, folder: null })
  const [deleteDialog, setDeleteDialog] = React.useState<{
    open: boolean
    folder: ChatFolder | null
  }>({ open: false, folder: null })

  const unfiled = sessions
    .filter((s) => !s.chatFolderId || !chatFolders.some((f) => f.id === s.chatFolderId))
    .sort(byRecency)
    .slice(0, 6)

  const sessionsByFolder = new Map<string, ChatSession[]>()
  for (const folder of chatFolders) {
    sessionsByFolder.set(
      folder.id,
      sessions.filter((s) => s.chatFolderId === folder.id).sort(byRecency)
    )
  }

  const isActive = (session: ChatSession) =>
    pathname.startsWith("/chat") && session.id === activeSessionId

  /** One session row — used both inside folders and in the recent list. */
  const SessionItem = ({
    session,
    inFolder = false,
  }: {
    session: ChatSession
    inFolder?: boolean
  }) => (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive(session)}
        onClick={() => setActiveSession(session.id)}
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
          {live && (
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
          )}
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

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="from-primary to-chart-1 text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br">
                  <Orbit className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">Orbit Docs</span>
                  <span className="text-muted-foreground truncate text-xs">
                    Jacobs · Engineering Solutions
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
          {live && (
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
          )}
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
                <SessionItem key={session.id} session={session} />
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
                    <AvatarFallback className="rounded-lg">RT</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Rohit Tokala</span>
                    <span className="text-muted-foreground truncate text-xs">
                      tokalarr@gmail.com
                    </span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem>Profile</DropdownMenuItem>
                <DropdownMenuItem>Workspace settings</DropdownMenuItem>
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
