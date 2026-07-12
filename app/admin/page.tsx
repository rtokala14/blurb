"use client"

import * as React from "react"
import { ShieldAlert } from "lucide-react"

import { AdminConsole } from "@/components/admin/admin-console"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { useOrbit } from "@/lib/store"

export default function AdminPage() {
  const live = useOrbit((s) => s.live)
  const isAdmin = useOrbit((s) => s.liveIsAdmin)

  if (live === null) return null
  if (!live || !isAdmin) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldAlert />
          </EmptyMedia>
          <EmptyTitle>Admin access required</EmptyTitle>
          <EmptyDescription>
            {live
              ? "Your account doesn't have admin permissions. Ask an existing admin to grant access."
              : "The admin console is available in live mode only."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return <AdminConsole />
}
