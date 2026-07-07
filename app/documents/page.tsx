import { Suspense } from "react"

import { DocumentsView } from "@/components/documents/documents-view"

export default function DocumentsPage() {
  return (
    <Suspense>
      <DocumentsView />
    </Suspense>
  )
}
