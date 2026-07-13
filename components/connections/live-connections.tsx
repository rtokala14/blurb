"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  Cloud,
  ExternalLink,
  FolderSync,
  Info,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { ShareDialog } from "@/components/share-dialog"
import { TimeAgo } from "@/components/time-ago"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { liveApi } from "@/lib/live-api"
import { useOrbit } from "@/lib/store"
import type { SharePointSite } from "@/lib/types"

interface SourceStats {
  totalFiles: number
  totalFolders: number
}

/**
 * Live Connections page: the user's real SharePoint sync sources with
 * status, contents stats, deep links, and owner-managed sharing (wired to
 * OrbitSyncSource.sharedWith via the edit action).
 */
export function LiveConnections() {
  const router = useRouter()
  const sites = useOrbit((s) => s.sites)
  const updateSite = useOrbit((s) => s.updateSite)
  const userEmail = useOrbit((s) => (s.liveUserEmail ?? "").toLowerCase())
  const [stats, setStats] = React.useState<Record<string, SourceStats | null>>({})
  const [shareFor, setShareFor] = React.useState<SharePointSite | null>(null)

  /* lazy per-source contents stats (server keeps the path index cached) */
  React.useEffect(() => {
    let cancelled = false
    for (const site of sites) {
      if (stats[site.id] !== undefined) continue
      setStats((prev) => ({ ...prev, [site.id]: null }))
      liveApi
        .syncBrowse(site.id, "")
        .then((data) => {
          if (cancelled) return
          setStats((prev) => ({
            ...prev,
            [site.id]: { totalFiles: data.totalFiles, totalFolders: data.totalFolders },
          }))
        })
        .catch(() => {
          if (cancelled) return
          setStats((prev) => ({ ...prev, [site.id]: { totalFiles: 0, totalFolders: 0 } }))
        })
    }
    return () => {
      cancelled = true
    }
  }, [sites, stats])

  const saveShare = async (emails: string[]) => {
    if (!shareFor) return
    const { sharedWith } = await liveApi.updateSyncSourceShare(shareFor.id, emails)
    updateSite(shareFor.id, { sharedWith })
    toast.success("Sharing updated", {
      description:
        sharedWith.length === 0
          ? `Only you can see “${shareFor.name}” now.`
          : `“${shareFor.name}” is shared with ${sharedWith.length} ${sharedWith.length === 1 ? "person" : "people"}.`,
    })
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
          <p className="text-muted-foreground text-sm">
            SharePoint sources synced into Orbit Docs. Shared sources appear in
            your colleagues' Library and chat scope too.
          </p>
        </div>

        {sites.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <Cloud className="text-muted-foreground size-8" />
              <p className="font-medium">No sync sources yet</p>
              <p className="text-muted-foreground max-w-md text-sm">
                SharePoint sources are provisioned with the Orbit sync agent.
                Once a source syncs, its folders and files appear here and in
                your Library automatically.
              </p>
            </CardContent>
          </Card>
        ) : (
          sites.map((site) => {
            const isOwner = (site.ownerEmail ?? "").toLowerCase() === userEmail
            const sourceStats = stats[site.id]
            const shared = site.sharedWith ?? []
            return (
              <Card key={site.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Cloud className="size-4 text-sky-600 dark:text-sky-400" />
                    {site.name}
                    {site.isActive === false ? (
                      <Badge variant="outline">Disabled</Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                    {site.attentionCount > 0 && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="size-3" />
                        {site.attentionCount} sync {site.attentionCount === 1 ? "error" : "errors"}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {isOwner ? "Owned by you" : `Owned by ${site.ownerEmail}`} ·
                    last synced <TimeAgo iso={site.lastSyncedAt} />
                  </CardDescription>
                  <CardAction className="flex gap-2">
                    {site.url && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={site.url} target="_blank" rel="noreferrer">
                          <ExternalLink /> SharePoint
                        </a>
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push(`/documents?folder=${encodeURIComponent(site.mappedFolderId)}`)}
                    >
                      <FolderSync /> Browse files
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                    {sourceStats === null || sourceStats === undefined ? (
                      <Skeleton className="h-4 w-40" />
                    ) : (
                      <span className="tabular-nums">
                        {sourceStats.totalFiles.toLocaleString()} files ·{" "}
                        {sourceStats.totalFolders.toLocaleString()} folders
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Users className="text-muted-foreground size-3.5" />
                    {shared.length === 0 ? (
                      <span className="text-muted-foreground text-sm">
                        Not shared with anyone
                      </span>
                    ) : (
                      <>
                        {shared.slice(0, 3).map((email) => (
                          <Badge key={email} variant="secondary" className="font-normal">
                            {email}
                          </Badge>
                        ))}
                        {shared.length > 3 && (
                          <Badge variant="outline" className="font-normal">
                            +{shared.length - 3} more
                          </Badge>
                        )}
                      </>
                    )}
                    {isOwner && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-7"
                        onClick={() => setShareFor(site)}
                      >
                        <Users /> Manage sharing
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}

        <div className="text-muted-foreground flex items-start gap-2 text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <p>
            New sources are provisioned with the Orbit sync agent on the machine
            that hosts the SharePoint library. Sharing a source gives colleagues
            read access to its synced documents — matching is case-insensitive.
          </p>
        </div>
      </div>

      {shareFor && (
        <ShareDialog
          open={shareFor !== null}
          onOpenChange={(open) => !open && setShareFor(null)}
          title={`Share “${shareFor.name}”`}
          description="People you add can browse this source and use its documents to ground their chats."
          ownerEmail={shareFor.ownerEmail}
          emails={shareFor.sharedWith ?? []}
          onSave={saveShare}
        />
      )}
    </div>
  )
}
