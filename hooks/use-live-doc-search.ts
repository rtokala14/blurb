"use client"

import * as React from "react"

import { liveApi } from "@/lib/live-api"
import { mapLiveDoc } from "@/lib/live-map"
import { useOrbit } from "@/lib/store"
import type { Doc } from "@/lib/types"

const DEBOUNCE_MS = 300
const MIN_QUERY = 2

/**
 * Debounced server-side document search (live mode only). The library holds
 * only the newest page of a ~19k-doc corpus, so any real lookup has to hit
 * the ontology. Returns matches that are NOT already in the local store —
 * render them alongside the locally filtered list.
 */
export function useLiveDocSearch(query: string): {
  results: Doc[]
  searching: boolean
} {
  const live = useOrbit((s) => s.live === true)
  const [results, setResults] = React.useState<Doc[]>([])
  const [searching, setSearching] = React.useState(false)
  const requestSeq = React.useRef(0)

  const q = query.trim()

  React.useEffect(() => {
    if (!live || q.length < MIN_QUERY) {
      setResults([])
      setSearching(false)
      return
    }
    const seq = ++requestSeq.current
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const { data } = await liveApi.searchDocs(q)
        if (seq !== requestSeq.current) return
        const known = new Set(useOrbit.getState().docs.map((d) => d.id))
        setResults(
          data.flatMap((d) =>
            known.has(d.primaryKey) ? [] : [mapLiveDoc(d, new Map())]
          )
        )
      } catch {
        if (seq === requestSeq.current) setResults([])
      } finally {
        if (seq === requestSeq.current) setSearching(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [live, q])

  return { results, searching }
}

/** Ensure a server-search hit exists in the store (e.g. before scoping it). */
export function adoptSearchResult(doc: Doc): void {
  const store = useOrbit.getState()
  if (!store.docs.some((d) => d.id === doc.id)) store.addDoc(doc)
}
