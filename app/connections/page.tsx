import { Suspense } from "react"

import { ConnectionsView } from "@/components/connections/connections-view"

export default function ConnectionsPage() {
  return (
    <Suspense>
      <ConnectionsView />
    </Suspense>
  )
}
