import { describe, expect, test } from "bun:test"

import { docTypeFromName, mapLiveDoc, mapLiveMessage, transcriptToTree } from "@/lib/live-map"
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
  folderId: null,
  status: "uploaded",
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
    ["c.xlsx", "pdf"],
    ["d.pptx", "pdf"],
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
    // No server folderId → fall back to the legacy folderByDocId map.
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

  test("prefers the server-resolved nested folderId over the fallback map", () => {
    const doc = mapLiveDoc(
      { ...baseDoc, folderId: "f-server" },
      new Map([["d1", "f-map"]])
    )
    expect(doc.folderId).toBe("f-server")
    expect(doc.source).toBe("upload")
  })

  test("root-level docs map to a null folderId", () => {
    expect(mapLiveDoc(baseDoc, new Map()).folderId).toBeNull()
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
      model: "gpt-4o",
      citations: [],
      scope: {},
    }
    const message = mapLiveMessage(row)
    expect(message.role).toBe("assistant")
    expect(message.content).toBe("See ⟦1⟧ here.")
    expect(message.parentId).toBe("m0")
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
      model: null,
      citations: [],
      scope: {},
    }
    const message = mapLiveMessage(row)
    expect(message.content).toBe("What are the renewal terms?")
    expect(message.citations).toBeUndefined()
  })
})

describe("transcriptToTree", () => {
  const rows: LiveMessageRow[] = [
    { id: "a", role: "user", content: "q1", createdAt: null, parentMessageId: null, model: null, citations: [], scope: {} },
    { id: "b", role: "assistant", content: "a1", createdAt: null, parentMessageId: "a", model: null, citations: [], scope: {} },
  ]

  test("builds a linked tree keyed by id with parent links", () => {
    const { messages } = transcriptToTree(rows, null)
    expect(Object.keys(messages)).toHaveLength(2)
    expect(messages.b.parentId).toBe("a")
  })

  test("uses the session cursor as the leaf when it resolves", () => {
    const { leafId } = transcriptToTree(rows, "a")
    expect(leafId).toBe("a")
  })

  test("falls back to the last row when the cursor is missing or stale", () => {
    expect(transcriptToTree(rows, null).leafId).toBe("b")
    expect(transcriptToTree(rows, "nope").leafId).toBe("b")
  })
})
