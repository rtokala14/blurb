"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Cloud,
  ExternalLink,
  FolderSync,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"

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
import { LiveConnections } from "@/components/connections/live-connections"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { TimeAgo } from "@/components/time-ago"
import { useOrbit } from "@/lib/store"
import { useSharePointSync } from "@/lib/use-sharepoint-sync"

const comingSoon = [
  { name: "Google Drive", detail: "Sync shared drives into the library" },
  { name: "Confluence", detail: "Index spaces and pages" },
  { name: "Slack", detail: "Send session exports to channels" },
]

export function ConnectionsView() {
  const live = useOrbit((s) => s.live === true)
  if (live) return <LiveConnections />
  return <DemoConnectionsView />
}

function DemoConnectionsView() {
  const searchParams = useSearchParams()
  const sites = useOrbit((s) => s.sites)
  const folders = useOrbit((s) => s.folders)
  const syncSite = useSharePointSync()
  const [addOpen, setAddOpen] = React.useState(false)
  const [siteUrl, setSiteUrl] = React.useState("")
  /** null = still checking, then live/simulated from the API route */
  const [sendgridLive, setSendgridLive] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    fetch("/api/notify-indexed")
      .then((res) => res.json())
      .then((data) => setSendgridLive(Boolean(data.configured)))
      .catch(() => setSendgridLive(false))
  }, [])

  /* deep link: /connections?sync=1 kicks off a sync of every site */
  const syncedOnLoad = React.useRef(false)
  React.useEffect(() => {
    if (searchParams.get("sync") && !syncedOnLoad.current) {
      syncedOnLoad.current = true
      sites.forEach((site) => syncSite(site.id))
    }
  }, [searchParams, sites, syncSite])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
            <p className="text-muted-foreground text-sm">
              Keep external sources synced into your document library.
            </p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus /> Connect a site
          </Button>
        </div>

        {/* SharePoint */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cloud className="size-4 text-sky-600 dark:text-sky-400" />
              Microsoft SharePoint
              <Badge variant="secondary" className="gap-1">
                <ShieldCheck className="size-3" /> Connected
              </Badge>
            </CardTitle>
            <CardDescription>
              Signed in as tokalarr@gmail.com · tenant jacobs.sharepoint.com
            </CardDescription>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                onClick={() => sites.forEach((s) => syncSite(s.id))}
              >
                <RefreshCw /> Sync all
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            {sites.map((site) => {
              const folder = folders.find((f) => f.id === site.mappedFolderId)
              return (
                <div key={site.id} className="rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {site.name}
                        {site.state === "syncing" ? (
                          <Badge variant="outline" className="gap-1">
                            <Spinner className="size-3" /> Syncing
                          </Badge>
                        ) : site.attentionCount > 0 ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="size-3" />
                            {site.attentionCount} to review
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <Check className="size-3" /> Healthy
                          </Badge>
                        )}
                      </p>
                      <p className="text-muted-foreground truncate font-mono text-xs">
                        {site.url}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={site.state === "syncing"}
                      onClick={() => syncSite(site.id)}
                    >
                      {site.state === "syncing" ? <Spinner /> : <RefreshCw />}
                      Sync now
                    </Button>
                  </div>
                  <Separator className="my-3" />
                  <div className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                    <span className="flex items-center gap-1.5">
                      <FolderSync className="size-3.5" />
                      Maps to{" "}
                      <Link
                        href="/documents"
                        className="text-foreground underline-offset-2 hover:underline"
                      >
                        {folder?.name}
                      </Link>
                    </span>
                    <span>{site.docCount} documents</span>
                    <span>Last synced <TimeAgo iso={site.lastSyncedAt} /></span>
                    <label className="ml-auto flex items-center gap-2">
                      Auto-sync hourly
                      <Switch
                        defaultChecked
                        onCheckedChange={(v) =>
                          toast(v ? "Auto-sync enabled" : "Auto-sync paused", {
                            description: site.name,
                          })
                        }
                      />
                    </label>
                  </div>
                  {site.attentionCount > 0 && site.state !== "syncing" && (
                    <div className="bg-destructive/5 border-destructive/20 mt-3 flex items-center gap-2 rounded-md border p-2.5 text-xs">
                      <AlertTriangle className="text-destructive size-3.5 shrink-0" />
                      <span>
                        {site.attentionCount} files changed in SharePoint and
                        locally — choose which version wins.
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto h-6 text-xs"
                        onClick={() => syncSite(site.id)}
                      >
                        Resolve with sync
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
          <CardFooter className="text-muted-foreground text-xs">
            Sync honors SharePoint permissions — users only query documents
            they can already open.
          </CardFooter>
        </Card>

        {/* SendGrid notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="text-chart-1 size-4" />
              Email notifications
              {sendgridLive === null ? (
                <Badge variant="outline" className="gap-1">
                  <Spinner className="size-3" /> Checking
                </Badge>
              ) : sendgridLive ? (
                <Badge variant="secondary" className="gap-1">
                  <ShieldCheck className="size-3" /> Live via SendGrid
                </Badge>
              ) : (
                <Badge variant="outline">Simulated — no API key</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Per-batch “indexing complete” emails, sent through SendGrid.
              Toggle it on any upload — you&apos;ll get one email when the
              whole batch is searchable.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-1.5 text-xs">
            <p>
              To go live, set these in <code className="bg-muted rounded px-1 py-0.5">.env.local</code>{" "}
              (see <code className="bg-muted rounded px-1 py-0.5">.env.example</code>):
            </p>
            <pre className="bg-muted overflow-x-auto rounded-md p-2.5 font-mono">
              {"SENDGRID_API_KEY=SG.xxxxx\nSENDGRID_FROM_EMAIL=notifications@jacobs.com"}
            </pre>
            <p>
              Until then, batches complete with a simulated notification so the
              flow can be reviewed end to end.
            </p>
          </CardContent>
        </Card>

        {/* Coming soon */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {comingSoon.map((integration) => (
            <Card key={integration.name} className="gap-2">
              <CardHeader>
                <CardTitle className="text-sm">{integration.name}</CardTitle>
                <CardDescription className="text-xs">
                  {integration.detail}
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button variant="outline" size="sm" disabled>
                  Coming soon
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>

      {/* Add site dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect a SharePoint site</DialogTitle>
            <DialogDescription>
              Paste a site URL. We&apos;ll map its document libraries into a
              synced folder and index the contents.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="site-url">Site URL</Label>
            <Input
              id="site-url"
              placeholder="https://jacobs.sharepoint.com/sites/…"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!siteUrl.trim()}
              onClick={() => {
                setAddOpen(false)
                setSiteUrl("")
                toast("Connection request sent", {
                  description:
                    "An admin must approve new site connections (placeholder).",
                  icon: <ExternalLink className="size-4" />,
                })
              }}
            >
              Connect <ArrowRight />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
