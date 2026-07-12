import { describe, expect, test } from "bun:test"

import {
  buildIndexFromRows,
  descendantDocPks,
  listChildren,
  searchIndex,
  type SyncItemRow,
} from "@/lib/foundry/sync-index"

const ROWS: SyncItemRow[] = [
  { sourceItemKey: "reports", itemType: "folder" },
  { sourceItemKey: "reports/2026/jan-wir-000382.pdf", itemType: "file", orbitObjectPk: "d1", syncStatus: "synced" },
  { sourceItemKey: "reports/2026/feb-wir-000401.pdf", itemType: "file", orbitObjectPk: "d2", syncStatus: "synced" },
  { sourceItemKey: "reports/archive/old.pdf", itemType: "file", orbitObjectPk: null as unknown as string, syncStatus: "pending" },
  { sourceItemKey: "readme.pdf", itemType: "file", orbitObjectPk: "d3", syncStatus: "synced" },
  { sourceItemKey: "empty folder", itemType: "folder" },
]

describe("buildIndexFromRows", () => {
  const index = buildIndexFromRows(ROWS)

  test("synthesizes ancestor folders missing from the item set", () => {
    // "reports/2026" and "reports/archive" were never registered as folders
    expect(index.byPath.get("reports/2026")?.isFolder).toBe(true)
    expect(index.byPath.get("reports/archive")?.isFolder).toBe(true)
  })

  test("counts files and folders", () => {
    expect(index.totalFiles).toBe(4)
    // reports, empty folder + synthesized 2026, archive
    expect(index.totalFolders).toBe(4)
  })

  test("root children are folders first, then files, name-sorted", () => {
    const { entries, total } = listChildren(index, "")
    expect(total).toBe(3)
    expect(entries.map((e) => e.name)).toEqual(["empty folder", "reports", "readme.pdf"])
  })

  test("folder rows carry direct child counts", () => {
    const reports = index.byPath.get("reports")!
    expect(reports.folderCount).toBe(2)
    expect(reports.fileCount).toBe(0)
  })

  test("path normalization strips slashes", () => {
    const { entries } = listChildren(index, "/reports/2026/")
    expect(entries.map((e) => e.name)).toEqual([
      "feb-wir-000401.pdf",
      "jan-wir-000382.pdf",
    ])
  })
})

describe("descendantDocPks", () => {
  const index = buildIndexFromRows(ROWS)

  test("recursive, indexed docs only", () => {
    expect(descendantDocPks(index, "reports").sort()).toEqual(["d1", "d2"])
  })

  test("empty path = whole source", () => {
    expect(descendantDocPks(index, "").sort()).toEqual(["d1", "d2", "d3"])
  })

  test("empty folder yields nothing", () => {
    expect(descendantDocPks(index, "empty folder")).toEqual([])
  })
})

describe("searchIndex", () => {
  const index = buildIndexFromRows(ROWS)

  test("substring match on embedded file codes", () => {
    const hits = searchIndex(index, "000382")
    expect(hits.map((h) => h.path)).toEqual(["reports/2026/jan-wir-000382.pdf"])
  })

  test("name-prefix outranks name-contains, folders before files", () => {
    const hits = searchIndex(index, "re")
    // "reports" (folder, prefix) before "readme.pdf" (file, prefix)
    expect(hits[0].path).toBe("reports")
    expect(hits.map((h) => h.path)).toContain("readme.pdf")
  })

  test("case-insensitive", () => {
    expect(searchIndex(index, "JAN-WIR")).toHaveLength(1)
  })

  test("empty query yields nothing", () => {
    expect(searchIndex(index, "  ")).toEqual([])
  })
})
