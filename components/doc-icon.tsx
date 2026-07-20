import { cn } from "@/lib/utils"
import type { DocType } from "@/lib/types"
import { docTypeConfig } from "@/components/doc-icon-config"

export function DocIcon({
  type,
  className,
}: {
  type: DocType
  className?: string
}) {
  const { icon: Icon, className: color } = docTypeConfig[type]
  return <Icon aria-hidden className={cn("size-4 shrink-0", color, className)} />
}
