"use client"

import Link from "next/link"
import {
  ArrowRight,
  ArrowUpRight,
  Cable,
  FileUp,
  FolderOpen,
  GitBranch,
  Mail,
  MessageSquareText,
  PenSquare,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react"

import { DocIcon } from "@/components/doc-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { TimeAgo } from "@/components/time-ago"
import { useOrbit } from "@/lib/store"
import type { ActivityItem } from "@/lib/types"

const activityIcons: Record<ActivityItem["kind"], React.ElementType> = {
  upload: FileUp,
  sync: RefreshCw,
  chat: MessageSquareText,
  artifact: Sparkles,
  share: Mail,
  export: ArrowUpRight,
}

export default function DashboardPage() {
  const docs = useOrbit((s) => s.docs)
  const sessions = useOrbit((s) => s.sessions)
  const artifacts = useOrbit((s) => s.artifacts)
  const sites = useOrbit((s) => s.sites)
  const activity = useOrbit((s) => s.activity)
  const setActiveSession = useOrbit((s) => s.setActiveSession)

  const ready = docs.filter((d) => d.status === "ready").length
  const inFlight = docs.filter(
    (d) => d.status === "processing" || d.status === "indexing" || d.status === "uploading"
  )
  const attention = docs.filter((d) => d.status === "error").length
  const indexedPct = Math.round((ready / Math.max(docs.length, 1)) * 100)

  const recentDocs = [...docs]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
  const recentSessions = [...sessions]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-chart-1 mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.18em]">
              <span className="bg-chart-1 inline-block size-1.5 rounded-full" />
              JACOBS · ENGINEERING SOLUTIONS
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Good morning, Rohit
            </h1>
            <p className="text-muted-foreground text-sm">
              Your library is {indexedPct}% indexed and ready to answer questions.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/documents?upload=1">
                <Upload /> Upload
              </Link>
            </Button>
            <Button asChild>
              <Link href="/chat">
                <PenSquare /> New session
              </Link>
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="gap-2">
            <CardHeader>
              <CardDescription>Documents indexed</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{ready}</CardTitle>
              <CardAction>
                <FolderOpen className="text-muted-foreground size-5" />
              </CardAction>
            </CardHeader>
            <CardFooter className="text-muted-foreground text-xs">
              {inFlight.length} processing · {attention} need attention
            </CardFooter>
          </Card>
          <Card className="gap-2">
            <CardHeader>
              <CardDescription>SharePoint sites</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{sites.length}</CardTitle>
              <CardAction>
                <Cable className="text-muted-foreground size-5" />
              </CardAction>
            </CardHeader>
            <CardFooter className="text-muted-foreground text-xs">
              <span>
                Last sync <TimeAgo iso={sites[0].lastSyncedAt} />
              </span>
            </CardFooter>
          </Card>
          <Card className="gap-2">
            <CardHeader>
              <CardDescription>Chat sessions</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {sessions.length}
              </CardTitle>
              <CardAction>
                <MessageSquareText className="text-muted-foreground size-5" />
              </CardAction>
            </CardHeader>
            <CardFooter className="text-muted-foreground text-xs">
              <span className="inline-flex items-center gap-1">
                <GitBranch className="size-3" /> branching + citations enabled
              </span>
            </CardFooter>
          </Card>
          <Card className="gap-2">
            <CardHeader>
              <CardDescription>AI artifacts</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {artifacts.length}
              </CardTitle>
              <CardAction>
                <Sparkles className="text-muted-foreground size-5" />
              </CardAction>
            </CardHeader>
            <CardFooter className="text-muted-foreground text-xs">
              Docs, spreadsheets & decks drafted by the agent
            </CardFooter>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Ingest pipeline */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Ingestion pipeline</CardTitle>
              <CardDescription>
                Live status of uploads, OCR, and index builds
              </CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/documents">
                    View library <ArrowRight />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span>Library index coverage</span>
                  <span className="text-muted-foreground tabular-nums">
                    {indexedPct}%
                  </span>
                </div>
                <Progress value={indexedPct} />
              </div>
              <Separator />
              {inFlight.length === 0 && attention === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nothing in flight. All documents are searchable.
                </p>
              ) : (
                <div className="space-y-3">
                  {inFlight.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-3">
                      <DocIcon type={doc.type} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{doc.name}</p>
                        <Progress value={doc.progress ?? 40} className="mt-1 h-1" />
                      </div>
                      <Badge variant="secondary" className="capitalize">
                        {doc.status}
                      </Badge>
                    </div>
                  ))}
                  {docs
                    .filter((d) => d.status === "error")
                    .map((doc) => (
                      <div key={doc.id} className="flex items-center gap-3">
                        <DocIcon type={doc.type} />
                        <p className="min-w-0 flex-1 truncate text-sm">
                          {doc.name}
                        </p>
                        <Badge variant="destructive">OCR failed</Badge>
                        <Button variant="outline" size="sm">
                          Retry
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
              <CardDescription>Across your workspace</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {activity.slice(0, 6).map((item) => {
                const Icon = activityIcons[item.kind]
                return (
                  <div key={item.id} className="flex gap-3">
                    <div className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full">
                      <Icon className="text-muted-foreground size-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm leading-tight">{item.text}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {item.detail} · <TimeAgo iso={item.time} />
                      </p>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Recent documents */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recently updated documents</CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/documents">
                    All documents <ArrowRight />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="divide-y">
              {recentDocs.map((doc) => (
                <Link
                  key={doc.id}
                  href={`/documents?doc=${doc.id}`}
                  className="hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5"
                >
                  <DocIcon type={doc.type} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{doc.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {doc.owner} · <TimeAgo iso={doc.updatedAt} />
                    </p>
                  </div>
                  {doc.source === "sharepoint" && (
                    <Badge variant="outline" className="text-xs">
                      SharePoint
                    </Badge>
                  )}
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* Recent sessions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pick up where you left off</CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/chat">
                    Open chat <ArrowRight />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="divide-y">
              {recentSessions.map((session) => (
                <Link
                  key={session.id}
                  href="/chat"
                  onClick={() => setActiveSession(session.id)}
                  className="hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5"
                >
                  <MessageSquareText className="text-muted-foreground size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{session.title}</p>
                    <p className="text-muted-foreground text-xs">
                      {session.scopeDocIds.length} documents in scope ·{" "}
                      <TimeAgo iso={session.updatedAt} />
                    </p>
                  </div>
                  <ArrowRight className="text-muted-foreground size-4" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
