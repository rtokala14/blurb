/**
 * Pure path-index logic for the sync-source file explorer — the testable
 * core of the PoC's services/sync_browse.py. No I/O.
 */

export interface SyncItemRow {
  sourceItemKey?: string
  itemType?: string
  orbitObjectPk?: string
  syncStatus?: string
}

export interface IndexedItem {
  name: string
  path: string
  isFolder: boolean
  orbitObjectPk: string | null
  syncStatus: string | null
  /** direct child counts, for folder rows */
  folderCount: number
  fileCount: number
}

export interface SourceIndex {
  /** parent path ("" = root) -> direct children, folders first, name-sorted */
  children: Map<string, IndexedItem[]>
  byPath: Map<string, IndexedItem>
  totalFiles: number
  totalFolders: number
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "")
}

function splitPath(path: string): { parent: string; name: string } {
  const norm = normalizePath(path)
  const idx = norm.lastIndexOf("/")
  if (idx === -1) return { parent: "", name: norm }
  return { parent: norm.slice(0, idx), name: norm.slice(idx + 1) }
}

/** Some sources only register file items — synthesize their ancestor folders. */
function ensureFolderChain(index: SourceIndex, path: string): void {
  const norm = normalizePath(path)
  if (!norm) return
  const parts = norm.split("/")
  for (let depth = 1; depth < parts.length; depth++) {
    const folderPath = parts.slice(0, depth).join("/")
    if (index.byPath.has(folderPath)) continue
    const { parent, name } = splitPath(folderPath)
    const node: IndexedItem = {
      name,
      path: folderPath,
      isFolder: true,
      orbitObjectPk: null,
      syncStatus: null,
      folderCount: 0,
      fileCount: 0,
    }
    index.byPath.set(folderPath, node)
    const siblings = index.children.get(parent) ?? []
    siblings.push(node)
    index.children.set(parent, siblings)
    index.totalFolders++
  }
}

export function buildIndexFromRows(rows: SyncItemRow[]): SourceIndex {
  const index: SourceIndex = {
    children: new Map(),
    byPath: new Map(),
    totalFiles: 0,
    totalFolders: 0,
  }

  for (const row of rows) {
    const path = normalizePath(String(row.sourceItemKey ?? ""))
    if (!path) continue
    const isFolder = (row.itemType ?? "").toLowerCase() === "folder"

    ensureFolderChain(index, path)

    const existing = index.byPath.get(path)
    if (existing) {
      // A synthesized folder may already exist; enrich it.
      if (isFolder) existing.isFolder = true
      continue
    }

    const { parent, name } = splitPath(path)
    const node: IndexedItem = {
      name,
      path,
      isFolder,
      orbitObjectPk: row.orbitObjectPk ?? null,
      syncStatus: row.syncStatus ?? null,
      folderCount: 0,
      fileCount: 0,
    }
    index.byPath.set(path, node)
    const siblings = index.children.get(parent) ?? []
    siblings.push(node)
    index.children.set(parent, siblings)
    if (isFolder) index.totalFolders++
    else index.totalFiles++
  }

  for (const [parentPath, kids] of index.children) {
    const node = index.byPath.get(parentPath)
    if (node) {
      node.folderCount = kids.filter((k) => k.isFolder).length
      node.fileCount = kids.filter((k) => !k.isFolder).length
    }
  }
  for (const kids of index.children.values()) {
    kids.sort((a, b) =>
      a.isFolder !== b.isFolder
        ? a.isFolder
          ? -1
          : 1
        : a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    )
  }
  return index
}

export function listChildren(
  index: SourceIndex,
  path: string,
  { offset = 0, limit = 200 }: { offset?: number; limit?: number } = {}
): { entries: IndexedItem[]; total: number } {
  const kids = index.children.get(normalizePath(path)) ?? []
  return { entries: kids.slice(offset, offset + limit), total: kids.length }
}

/** Every indexed orbitObjectPk under a folder, recursively ("" = whole source). */
export function descendantDocPks(index: SourceIndex, path: string): string[] {
  const pks: string[] = []
  const stack = [normalizePath(path)]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const folder = stack.pop()!
    if (seen.has(folder)) continue
    seen.add(folder)
    for (const child of index.children.get(folder) ?? []) {
      if (child.isFolder) stack.push(child.path)
      else if (child.orbitObjectPk) pks.push(child.orbitObjectPk)
    }
  }
  return pks
}

/**
 * Case-insensitive substring search over every path in the source.
 * Ranking (PoC): name-prefix > name-contains > path-only, folders before
 * files within a rank, then by path.
 */
export function searchIndex(
  index: SourceIndex,
  query: string,
  limit = 100
): IndexedItem[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const scored: { rank: number; pathL: string; node: IndexedItem }[] = []
  for (const [path, node] of index.byPath) {
    const nameL = node.name.toLowerCase()
    const pathL = path.toLowerCase()
    const nameHit = nameL.includes(needle)
    if (!nameHit && !pathL.includes(needle)) continue
    const rank = nameHit ? (nameL.startsWith(needle) ? 0 : 1) : 2
    scored.push({ rank, pathL, node })
  }
  scored.sort((a, b) =>
    a.rank !== b.rank
      ? a.rank - b.rank
      : a.node.isFolder !== b.node.isFolder
        ? a.node.isFolder
          ? -1
          : 1
        : a.pathL.localeCompare(b.pathL)
  )
  return scored.slice(0, limit).map((s) => s.node)
}
