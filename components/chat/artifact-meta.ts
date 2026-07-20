import { FileText } from "lucide-react"

import type { ArtifactKind } from "@/lib/types"

export const artifactMeta: Record<
  ArtifactKind,
  { icon: React.ElementType; label: string; className: string }
> = {
  doc: {
    icon: FileText,
    label: "Document",
    className: "text-blue-600 dark:text-blue-400",
  },
}
