import {
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileType2,
  Presentation,
  Table2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { DocType } from "@/lib/types"

const config: Record<
  DocType,
  { icon: React.ElementType; className: string; label: string }
> = {
  pdf: { icon: FileType2, className: "text-red-600 dark:text-red-400", label: "PDF" },
  docx: { icon: FileText, className: "text-blue-600 dark:text-blue-400", label: "Word" },
  xlsx: {
    icon: FileSpreadsheet,
    className: "text-emerald-600 dark:text-emerald-400",
    label: "Excel",
  },
  pptx: {
    icon: Presentation,
    className: "text-orange-600 dark:text-orange-400",
    label: "PowerPoint",
  },
  csv: { icon: Table2, className: "text-teal-600 dark:text-teal-400", label: "CSV" },
  md: { icon: FileCode2, className: "text-violet-600 dark:text-violet-400", label: "Markdown" },
}

export function docTypeLabel(type: DocType) {
  return config[type].label
}

export function DocIcon({
  type,
  className,
}: {
  type: DocType
  className?: string
}) {
  const { icon: Icon, className: color } = config[type]
  return <Icon aria-hidden className={cn("size-4 shrink-0", color, className)} />
}
