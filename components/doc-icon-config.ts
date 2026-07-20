import {
  FileCode2,
  FileText,
  FileType2,
  Table2,
} from "lucide-react"

import type { DocType } from "@/lib/types"

export const docTypeConfig: Record<
  DocType,
  { icon: React.ElementType; className: string; label: string }
> = {
  pdf: { icon: FileType2, className: "text-red-600 dark:text-red-400", label: "PDF" },
  docx: { icon: FileText, className: "text-blue-600 dark:text-blue-400", label: "Word" },
  csv: { icon: Table2, className: "text-teal-600 dark:text-teal-400", label: "CSV" },
  md: { icon: FileCode2, className: "text-violet-600 dark:text-violet-400", label: "Markdown" },
}

export function docTypeLabel(type: DocType) {
  return docTypeConfig[type].label
}
