"use client"

import * as React from "react"

import { relativeTime } from "@/lib/format"

/**
 * Relative timestamp that tolerates the gap between prerender time and
 * hydration time (the text is recomputed on mount, and the initial
 * mismatch is expected).
 */
export function TimeAgo({ iso }: { iso: string }) {
  const [text, setText] = React.useState(() => relativeTime(iso))
  React.useEffect(() => {
    setText(relativeTime(iso))
  }, [iso])
  return <span suppressHydrationWarning>{text}</span>
}
