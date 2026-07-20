"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  Cloud,
  ExternalLink,
  FolderSync,
  Info,
} from "lucide-react"

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
import { useOrbit } from "@/lib/store"

/**
 * Live Connections page. SharePoint sync sources were removed in the v3
 * pipeline, so the sources list is always empty and the browse/search/share
 * endpoints no longer exist. This renders whatever sources the store holds
 * (empty in practice) as read-only cards, with no server calls.
 */
export function LiveConnections() {
  const router = useRouter()
  const sites = useOrbit((s) => s.sites)
  const userEmail = useOrbit((s) => (s.liveUserEmail ?? "").toLowerCase())

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
          <p className="text-muted-foreground text-sm">
            External document sources synced into Orbit Docs.
          </p>
        </div>

        {sites.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <Cloud className="text-muted-foreground size-8" />
              <p className="font-medium">No connected sources</p>
              <p className="text-muted-foreground max-w-md text-sm">
                This workspace grounds chats on documents you upload to your
                Library. External sync sources aren&apos;t available here.
              </p>
            </CardContent>
          </Card>
        ) : (
          sites.map((site) => {
            const isOwner = (site.ownerEmail ?? "").toLowerCase() === userEmail
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
                          <ExternalLink /> Open source
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
              </Card>
            )
          })
        )}

        <div className="text-muted-foreground flex items-start gap-2 text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <p>
            Upload documents from the Library to make them available for
            grounded chat — email matching for shared folders is
            case-insensitive.
          </p>
        </div>
      </div>
    </div>
  )
}
