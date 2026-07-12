import { describe, expect, test } from "bun:test"

import {
  extractMediaItemRid,
  linearizeBranchPath,
  serializeDoc,
  serializeSession,
  type BranchRow,
  type DocRow,
  type MessageRow,
  type SessionRow,
} from "@/lib/foundry/ontology"

describe("extractMediaItemRid", () => {
  test("reads a media set view item reference", () => {
    const reference = {
      mimeType: "application/pdf",
      reference: {
        type: "mediaSetViewItem",
        mediaSetViewItem: {
          mediaSetRid: "ri.mio.main.media-set.abc",
          mediaSetViewRid: "ri.mio.main.view.def",
          mediaItemRid: "ri.mio.main.media-item.xyz",
        },
      },
    }
    expect(extractMediaItemRid(reference)).toBe("ri.mio.main.media-item.xyz")
  })

  test("deep-scans arbitrary shapes", () => {
    expect(
      extractMediaItemRid({ nested: { deep: "ri.mio.main.media-item.deep" } })
    ).toBe("ri.mio.main.media-item.deep")
  })

  test("returns null when absent", () => {
    expect(extractMediaItemRid({ foo: "bar" })).toBeNull()
    expect(extractMediaItemRid(null)).toBeNull()
  })
})

describe("linearizeBranchPath", () => {
  const messages: MessageRow[] = [
    { __primaryKey: "a", message: "a", parentMessageId: undefined },
    { __primaryKey: "b", message: "b", parentMessageId: "a" },
    { __primaryKey: "c", message: "c", parentMessageId: "b" },
    { __primaryKey: "d", message: "d", parentMessageId: "a" },
  ]

  test("walks parents from the branch head", () => {
    const branch: BranchRow = { __primaryKey: "br", headMessageId: "c" }
    const path = linearizeBranchPath(messages, branch)
    expect(path.map((m) => m.__primaryKey)).toEqual(["a", "b", "c"])
  })

  test("follows an alternate branch head", () => {
    const branch: BranchRow = { __primaryKey: "br2", headMessageId: "d" }
    const path = linearizeBranchPath(messages, branch)
    expect(path.map((m) => m.__primaryKey)).toEqual(["a", "d"])
  })

  test("empty when no head", () => {
    expect(linearizeBranchPath(messages, { __primaryKey: "x" })).toEqual([])
  })

  test("terminates on cycles", () => {
    const cyclic: MessageRow[] = [
      { __primaryKey: "p", parentMessageId: "q" },
      { __primaryKey: "q", parentMessageId: "p" },
    ]
    const path = linearizeBranchPath(cyclic, { __primaryKey: "b", headMessageId: "p" })
    expect(path.length).toBeLessThanOrEqual(2)
  })
})

describe("serializeDoc", () => {
  test("prefers index-status completeness over the doc flag", () => {
    const doc: DocRow = {
      __primaryKey: "d1",
      documentName: "MSA.pdf",
      addedBy: "Rohit.Tokala@jacobs.com",
      isActive: true,
      isIndexed: false,
      noPages: 10,
    }
    const serialized = serializeDoc(doc, {
      sharedFolderNames: new Map(),
      indexStatus: new Map([
        ["d1", { __primaryKey: "s1", isIndexingComplete: true, noPages: 42 }],
      ]),
      userEmail: "rohit.tokala@jacobs.com",
    })
    expect(serialized.isIndexed).toBe(true)
    expect(serialized.noPages).toBe(42)
    expect(serialized.addedBy).toBe("rohit.tokala@jacobs.com")
  })

  test("flags shared-from-folder for other owners", () => {
    const doc: DocRow = {
      __primaryKey: "d2",
      documentName: "Shared.pdf",
      addedBy: "someone.else@jacobs.com",
      isActive: true,
    }
    const serialized = serializeDoc(doc, {
      sharedFolderNames: new Map([["d2", ["Legal"]]]),
      indexStatus: new Map(),
      userEmail: "rohit.tokala@jacobs.com",
    })
    expect(serialized.isSharedFromFolder).toBe(true)
    expect(serialized.sharedFolderNames).toEqual(["Legal"])
  })
})

describe("serializeSession", () => {
  test("maps run state and metadata", () => {
    const row: SessionRow = {
      __primaryKey: "s1",
      title: "Renewals",
      mode: "thinking",
      docsAttached: ["d1"],
      currentRunStatus: "in_progress",
      updatedAt: "2026-07-01T00:00:00Z",
    }
    const serialized = serializeSession(row, 5)
    expect(serialized.rid).toBe("s1")
    expect(serialized.mode).toBe("thinking")
    expect(serialized.metadata.messageCount).toBe(5)
    expect(serialized.currentRun.status).toBe("in_progress")
  })
})
