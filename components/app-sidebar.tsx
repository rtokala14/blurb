"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Cable,
  FolderOpen,
  LayoutDashboard,
  MessageSquareText,
  MoreHorizontal,
  Orbit,
  PenSquare,
  Pin,
  Sparkles,
  Trash2,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useOrbit } from "@/lib/store"

const nav = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Chat", href: "/chat", icon: MessageSquareText },
  { title: "Documents", href: "/documents", icon: FolderOpen },
  { title: "Studio", href: "/studio", icon: Sparkles },
  { title: "Connections", href: "/connections", icon: Cable },
]

export function AppSidebar() {
  const pathname = usePathname()
  const sessions = useOrbit((s) => s.sessions)
  const activeSessionId = useOrbit((s) => s.activeSessionId)
  const setActiveSession = useOrbit((s) => s.setActiveSession)
  const createSession = useOrbit((s) => s.createSession)
  const togglePinSession = useOrbit((s) => s.togglePinSession)
  const deleteSession = useOrbit((s) => s.deleteSession)

  const recent = [...sessions]
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt.localeCompare(a.updatedAt)
    })
    .slice(0, 6)

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
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Recent sessions</SidebarGroupLabel>
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
              {recent.map((session) => (
                <SidebarMenuItem key={session.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={
                      pathname.startsWith("/chat") &&
                      session.id === activeSessionId
                    }
                    onClick={() => setActiveSession(session.id)}
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
                    <DropdownMenuContent side="right" align="start">
                      <DropdownMenuItem
                        onClick={() => togglePinSession(session.id)}
                      >
                        <Pin />
                        {session.pinned ? "Unpin" : "Pin"}
                      </DropdownMenuItem>
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
    </Sidebar>
  )
}
