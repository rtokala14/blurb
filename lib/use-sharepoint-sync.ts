"use client"

import * as React from "react"
import { toast } from "sonner"

import { useOrbit } from "@/lib/store"

/**
 * Simulates a SharePoint delta sync for a site: flips the site and its
 * mapped documents into a syncing state, then settles them back with a
 * fresh timestamp and an activity entry.
 */
export function useSharePointSync() {
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([])

  React.useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  return React.useCallback((siteId: string) => {
    const { sites, docs, updateSite, updateDoc, pushActivity } =
      useOrbit.getState()
    const site = sites.find((s) => s.id === siteId)
    if (!site || site.state === "syncing") return

    updateSite(siteId, { state: "syncing" })
    const affected = docs.filter((d) => d.folderId === site.mappedFolderId)
    affected.forEach((d) => updateDoc(d.id, { status: "syncing" }))
    toast(`Syncing ${site.name}…`, {
      description: "Fetching changes from SharePoint",
    })

    timers.current.push(
      setTimeout(() => {
        const now = new Date().toISOString()
        useOrbit.getState().updateSite(siteId, {
          state: "idle",
          attentionCount: 0,
          lastSyncedAt: now,
        })
        affected.forEach((d) =>
          useOrbit.getState().updateDoc(d.id, { status: "ready", updatedAt: now })
        )
        pushActivity({
          kind: "sync",
          text: `SharePoint sync completed for ${site.name}`,
          detail: `${affected.length} documents up to date`,
        })
        toast.success(`${site.name} is up to date`, {
          description: `${affected.length} documents checked · 0 conflicts`,
        })
      }, 2800)
    )
  }, [])
}
