"use client"

import * as React from "react"
import {
  FileText,
  Infinity as InfinityIcon,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  Upload,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { TrendChart } from "@/components/admin/trend-chart"
import { UserManageDialog } from "@/components/admin/user-manage-dialog"
import { TimeAgo } from "@/components/time-ago"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  adminApi,
  type AdminOverview,
  type AdminSessionRow,
  type AdminUser,
} from "@/lib/live-api"
import { cn } from "@/lib/utils"

/**
 * Admin console: Overview (insights with include-admins / include-synced
 * toggles), Users (flags + rate limits), Sessions (workspace-wide).
 */

function StatTile({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
}) {
  return (
    <Card className="gap-1.5 p-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs font-medium">{label}</p>
        <Icon className="text-muted-foreground/60 size-4" />
      </div>
      <p className="text-2xl font-semibold">{value}</p>
      {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
    </Card>
  )
}

const compact = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 10_000
      ? `${Math.round(n / 1000)}K`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}K`
        : String(n)

export function AdminConsole() {
  const [tab, setTab] = React.useState<"overview" | "users" | "sessions">("overview")

  /* overview state */
  const [days, setDays] = React.useState(30)
  const [includeAdmins, setIncludeAdmins] = React.useState(false)
  const [includeSynced, setIncludeSynced] = React.useState(true)
  const [overview, setOverview] = React.useState<AdminOverview | null>(null)
  const [loadingOverview, setLoadingOverview] = React.useState(true)
  const [showTable, setShowTable] = React.useState(false)

  /* users state */
  const [users, setUsers] = React.useState<AdminUser[] | null>(null)
  const [userQuery, setUserQuery] = React.useState("")
  const [managing, setManaging] = React.useState<AdminUser | null>(null)

  /* sessions state */
  const [sessions, setSessions] = React.useState<AdminSessionRow[] | null>(null)
  const [sessionQuery, setSessionQuery] = React.useState("")

  const loadOverview = React.useCallback(async () => {
    setLoadingOverview(true)
    try {
      setOverview(await adminApi.overview({ days, includeAdmins, includeSynced }))
    } catch (error) {
      toast.error("Couldn't load the dashboard", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setLoadingOverview(false)
    }
  }, [days, includeAdmins, includeSynced])

  React.useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  React.useEffect(() => {
    if (tab === "users" && users === null) {
      adminApi
        .users()
        .then((r) => setUsers(r.data))
        .catch(() => toast.error("Couldn't load users"))
    }
    if (tab === "sessions" && sessions === null) {
      adminApi
        .sessions()
        .then((r) => setSessions(r.data))
        .catch(() => toast.error("Couldn't load sessions"))
    }
  }, [tab, users, sessions])

  const totals = overview?.totals

  const filteredUsers = (users ?? []).filter(
    (u) =>
      !userQuery ||
      u.email.includes(userQuery.toLowerCase()) ||
      u.name.toLowerCase().includes(userQuery.toLowerCase())
  )
  const filteredSessions = (sessions ?? []).filter(
    (s) =>
      !sessionQuery ||
      s.title.toLowerCase().includes(sessionQuery.toLowerCase()) ||
      s.user.includes(sessionQuery.toLowerCase())
  )

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Admin console</h1>
          <p className="text-muted-foreground text-sm">
            Workspace usage, users and limits
          </p>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "overview" && (
        <>
          {/* filter row — one row above the charts */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-3 py-2">
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Switch checked={includeAdmins} onCheckedChange={setIncludeAdmins} />
              Include admin activity
            </Label>
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Switch checked={includeSynced} onCheckedChange={setIncludeSynced} />
              Include SharePoint-synced documents
            </Label>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label="Refresh dashboard"
              onClick={() => void loadOverview()}
            >
              {loadingOverview ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
            </Button>
          </div>

          {!totals ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : (
            <>
              {/* KPI row */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile
                  label="Active users"
                  value={String(totals.activeUsers)}
                  sub={`${totals.users} total · ${totals.admins} admins`}
                  icon={Users}
                />
                <StatTile
                  label="Sessions today"
                  value={String(totals.sessionsToday)}
                  sub={`${totals.thinkingSessionsInRange} thinking-mode in range`}
                  icon={MessageSquareText}
                />
                <StatTile
                  label="Uploads today"
                  value={String(totals.uploadsToday)}
                  sub={`${totals.usersNearQuota} ${totals.usersNearQuota === 1 ? "user" : "users"} near quota`}
                  icon={Upload}
                />
                <StatTile
                  label="Documents added today"
                  value={String(totals.docsToday)}
                  sub={includeSynced ? "manual + synced" : "manual uploads only"}
                  icon={FileText}
                />
              </div>

              {/* corpus row */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile
                  label="Documents in corpus"
                  value={compact(totals.corpus.documents)}
                  sub={`${compact(totals.corpus.manualDocuments)} manual · ${compact(totals.corpus.syncedDocuments)} synced`}
                  icon={FileText}
                />
                <Card className="gap-1.5 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-muted-foreground text-xs font-medium">Indexing coverage</p>
                    <ShieldCheck className="text-muted-foreground/60 size-4" />
                  </div>
                  <p className="text-2xl font-semibold">{totals.corpus.indexedPct}%</p>
                  <Progress value={totals.corpus.indexedPct} className="h-1.5" />
                  <p className="text-muted-foreground text-xs">
                    {compact(totals.corpus.indexed)} of {compact(totals.corpus.indexedBase)} indexed
                  </p>
                </Card>
                <StatTile
                  label="Total pages"
                  value={compact(totals.corpus.totalPages)}
                  sub="across the active corpus"
                  icon={Table2}
                />
                <StatTile
                  label="Unlimited-upload users"
                  value={String(totals.unlimitedUsers)}
                  sub="exempt from daily limits"
                  icon={InfinityIcon}
                />
              </div>

              {/* trend chart + table relief */}
              <Card className="gap-3 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Daily activity</p>
                    <p className="text-muted-foreground text-xs">
                      Turns, sessions and manual document uploads over the last {overview!.days} days
                      {includeAdmins ? "" : " · admin activity excluded"}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setShowTable((v) => !v)}>
                    {showTable ? "Hide data" : "View data"}
                  </Button>
                </div>
                <TrendChart points={overview!.trends} />
                {showTable && (
                  <div className="max-h-64 overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Turns</TableHead>
                          <TableHead className="text-right">Sessions</TableHead>
                          <TableHead className="text-right">Documents</TableHead>
                          <TableHead className="text-right">Active users</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...overview!.trends].reverse().map((p) => (
                          <TableRow key={p.date}>
                            <TableCell>{p.date}</TableCell>
                            <TableCell className="text-right tabular-nums">{p.turns}</TableCell>
                            <TableCell className="text-right tabular-nums">{p.sessions}</TableCell>
                            <TableCell className="text-right tabular-nums">{p.documents}</TableCell>
                            <TableCell className="text-right tabular-nums">{p.uniqueUsers}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>

              <div className="grid gap-3 lg:grid-cols-2">
                {/* power users */}
                <Card className="gap-3 p-4">
                  <p className="text-sm font-semibold">Most active users</p>
                  {overview!.powerUsers.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No activity in this range.</p>
                  ) : (
                    <div className="space-y-2">
                      {overview!.powerUsers.map((u) => {
                        const maxTurns = overview!.powerUsers[0]?.turns || 1
                        return (
                          <div key={u.email} className="space-y-1">
                            <div className="flex items-baseline justify-between gap-2 text-sm">
                              <span className="truncate">
                                {u.name}
                                {u.isAdmin && (
                                  <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[9px]">
                                    admin
                                  </Badge>
                                )}
                              </span>
                              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                                {u.turns} turns · {u.sessions} sessions · {u.documents} docs
                              </span>
                            </div>
                            <div className="bg-muted h-2 overflow-hidden rounded-[4px]">
                              <div
                                className="h-full rounded-r-[4px] bg-[#2a78d6] dark:bg-[#3987e5]"
                                style={{ width: `${Math.max(4, (u.turns / maxTurns) * 100)}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </Card>

                {/* near quota */}
                <Card className="gap-3 p-4">
                  <p className="text-sm font-semibold">Users near their upload limit</p>
                  {overview!.usersNearQuota.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      Nobody is close to their daily limit.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {overview!.usersNearQuota.map((u) => (
                        <div key={u.email} className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{u.name}</p>
                            <p className="text-muted-foreground truncate text-xs">{u.email}</p>
                          </div>
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {u.uploadsUsedToday}/{u.effectiveLimit}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7"
                            onClick={() => {
                              setTab("users")
                              setUserQuery(u.email)
                            }}
                          >
                            Manage
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </>
          )}
        </>
      )}

      {tab === "users" && (
        <>
          <div className="relative w-72">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              placeholder="Filter by name or email…"
              className="h-8 pl-8"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
            />
          </div>
          {users === null ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : (
            <Card className="overflow-hidden p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="w-28">Role</TableHead>
                    <TableHead className="w-44">Uploads today</TableHead>
                    <TableHead className="hidden w-28 text-right md:table-cell">Documents</TableHead>
                    <TableHead className="hidden w-28 lg:table-cell">Updated</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => (
                    <TableRow key={u.primaryKey} className={cn(!u.isActive && "opacity-50")}>
                      <TableCell>
                        <p className="font-medium">{u.name}</p>
                        <p className="text-muted-foreground text-xs">{u.email}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {u.isAdmin && <Badge variant="secondary">Admin</Badge>}
                          {!u.isActive && <Badge variant="destructive">Inactive</Badge>}
                          {u.isActive && !u.isAdmin && <Badge variant="outline">Member</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {u.effectiveLimit === null ? (
                          <span className="text-muted-foreground flex items-center gap-1 text-xs">
                            <InfinityIcon className="size-3.5" /> Unlimited
                          </span>
                        ) : (
                          <div className="space-y-1">
                            <Progress
                              value={(u.uploadsUsedToday / Math.max(u.effectiveLimit, 1)) * 100}
                              className="h-1.5"
                            />
                            <p className="text-muted-foreground text-xs tabular-nums">
                              {u.uploadsUsedToday} of {u.effectiveLimit}
                              {u.bonusUploadLimit > 0 && ` (+${u.bonusUploadLimit} bonus)`}
                            </p>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {u.documents + u.syncedDocuments > 0
                          ? compact(u.documents + u.syncedDocuments)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">
                        {u.updatedAt ? <TimeAgo iso={u.updatedAt} /> : "—"}
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => setManaging(u)}>
                          Manage
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}

      {tab === "sessions" && (
        <>
          <div className="relative w-72">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              placeholder="Filter by title or user…"
              className="h-8 pl-8"
              value={sessionQuery}
              onChange={(e) => setSessionQuery(e.target.value)}
            />
          </div>
          {sessions === null ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : (
            <Card className="overflow-hidden p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Session</TableHead>
                    <TableHead className="hidden md:table-cell">User</TableHead>
                    <TableHead className="w-24">Mode</TableHead>
                    <TableHead className="w-28">State</TableHead>
                    <TableHead className="hidden w-28 lg:table-cell">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSessions.map((s) => (
                    <TableRow key={s.rid}>
                      <TableCell className="max-w-md truncate font-medium">{s.title}</TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs md:table-cell">
                        {s.user}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.mode === "thinking" ? "secondary" : "outline"}>
                          {s.mode}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {s.runStatus === "in_progress" ? (
                          <Badge variant="secondary" className="gap-1">
                            <Spinner className="size-3" /> running
                          </Badge>
                        ) : s.runStatus === "failed" ? (
                          <Badge variant="destructive">failed</Badge>
                        ) : (
                          <Badge variant="outline">idle</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">
                        {s.updatedAt ? <TimeAgo iso={s.updatedAt} /> : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}

      <UserManageDialog
        user={managing}
        onOpenChange={(open) => !open && setManaging(null)}
        onSaved={(updated) => {
          setUsers((prev) =>
            prev?.map((u) => (u.primaryKey === updated.primaryKey ? updated : u)) ?? null
          )
          void loadOverview()
        }}
      />
    </div>
  )
}
