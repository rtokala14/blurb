import { describe, expect, test } from "bun:test"

import {
  docTypeFromName,
  mapLiveDoc,
  mapLiveMessage,
  SYNC_FOLDER_PREFIX,
  transcriptToTree,
} from "@/lib/live-map"
import type { LiveDocument, LiveMessageRow } from "@/lib/live-api"

const baseDoc: LiveDocument = {
  primaryKey: "d1",
  documentName: "Acme MSA.pdf",
  addedBy: "rohit.tokala@jacobs.com",
  isActive: true,
  isIndexed: true,
  isSharedFromFolder: false,
  sharedFolderNames: [],
  createdAt: "2026-06-01T00:00:00Z",
  noPages: 42,
  indexStatus: null,
  isVLM: false,
  sourceType: null,
  sourceWebUrl: null,
  sourceSyncConfigPk: null,
  mediaItemRid: "ri.mio.main.media-item.abc",
}

describe("docTypeFromName", () => {
  const cases: [string, string][] = [
    ["a.pdf", "pdf"],
    ["b.docx", "docx"],
    ["c.xlsx", "xlsx"],
    ["d.pptx", "pptx"],
    ["e.csv", "csv"],
    ["f.md", "md"],
    ["noext", "pdf"],
  ]
  test.each(cases)("%s → %s", (name, expected) => {
    expect(docTypeFromName(name)).toBe(expected as ReturnType<typeof docTypeFromName>)
  })
})

describe("mapLiveDoc", () => {
  test("maps an indexed upload as ready with its media rid", () => {
    const doc = mapLiveDoc(baseDoc, new Map([["d1", "f-legal"]]))
    expect(doc.status).toBe("ready")
    expect(doc.folderId).toBe("f-legal")
    expect(doc.source).toBe("upload")
    expect(doc.mediaRid).toBe("ri.mio.main.media-item.abc")
    expect(doc.type).toBe("pdf")
  })

  test("maps a pending doc as processing", () => {
    const doc = mapLiveDoc({ ...baseDoc, isIndexed: false }, new Map())
    expect(doc.status).toBe("processing")
  })

  test("routes synced docs to their sync folder", () => {
    const doc = mapLiveDoc(
      { ...baseDoc, sourceType: "sharepoint", sourceSyncConfigPk: "src1" },
      new Map()
    )
    expect(doc.source).toBe("sharepoint")
    expect(doc.folderId).toBe(`${SYNC_FOLDER_PREFIX}src1`)
  })
})

describe("mapLiveMessage", () => {
  test("parses citations out of assistant content", () => {
    const row: LiveMessageRow = {
      id: "m1",
      role: "assistant",
      content: 'See <source id="ri.mio.main.media-item.x" name="Doc">3</source> here.',
      createdAt: "2026-07-01T00:00:00Z",
      parentMessageId: "m0",
      branchId: "b1",
      hasAlternateBranches: false,
      alternateBranchCount: 0,
    }
    const message = mapLiveMessage(row)
    expect(message.role).toBe("assistant")
    expect(message.content).toBe("See ⟦1⟧ here.")
    expect(message.citations).toHaveLength(1)
    expect(message.citations?.[0].mediaRid).toBe("ri.mio.main.media-item.x")
  })

  test("leaves user content untouched", () => {
    const row: LiveMessageRow = {
      id: "m1",
      role: "user",
      content: "What are the renewal terms?",
      createdAt: null,
      parentMessageId: null,
      branchId: null,
      hasAlternateBranches: null,
      alternateBranchCount: null,
    }
    const message = mapLiveMessage(row)
    expect(message.content).toBe("What are the renewal terms?")
    expect(message.citations).toBeUndefined()
  })
})

describe("transcriptToTree", () => {
  test("builds a linked tree and returns the leaf", () => {
    const rows: LiveMessageRow[] = [
      { id: "a", role: "user", content: "q1", createdAt: null, parentMessageId: null, branchId: null, hasAlternateBranches: null, alternateBranchCount: null },
      { id: "b", role: "assistant", content: "a1", createdAt: null, parentMessageId: "a", branchId: null, hasAlternateBranches: null, alternateBranchCount: null },
    ]
    const { messages, leafId } = transcriptToTree(rows)
    expect(Object.keys(messages)).toHaveLength(2)
    expect(messages.b.parentId).toBe("a")
    expect(leafId).toBe("b")
  })

  test("backfills lineage for legacy rows without parents", () => {
    const rows: LiveMessageRow[] = [
      { id: "a", role: "user", content: "q", createdAt: null, parentMessageId: null, branchId: null, hasAlternateBranches: null, alternateBranchCount: null },
      { id: "b", role: "assistant", content: "a", createdAt: null, parentMessageId: null, branchId: null, hasAlternateBranches: null, alternateBranchCount: null },
    ]
    const { messages } = transcriptToTree(rows)
    expect(messages.b.parentId).toBe("a")
  })
})
