import { describe, expect, test } from "bun:test"

import {
  activeBonusUploads,
  linearizeMessagePath,
  normalizeEmail,
  parseOptions,
  pk,
  sameEmail,
  serializeDoc,
  serializeMessage,
  serializeSession,
  type DocRow,
  type GrantRow,
  type MessageRow,
  type SessionRow,
} from "@/lib/foundry/ontology"

/* ------------------------------------------------------------------ */
/* sanitize helpers                                                     */
/* ------------------------------------------------------------------ */

describe("pk", () => {
  test("prefers __primaryKey over the typed id fields", () => {
    expect(pk({ __primaryKey: "a", documentId: "b" })).toBe("a")
  })
  test("falls back through folder/doc/session/message/grant ids", () => {
    expect(pk({ folderId: "f1" })).toBe("f1")
    expect(pk({ documentId: "d1" })).toBe("d1")
    expect(pk({ sessionId: "s1" })).toBe("s1")
    expect(pk({ messageId: "m1" })).toBe("m1")
    expect(pk({ grantId: "g1" })).toBe("g1")
  })
  test("empty string when nothing set", () => {
    expect(pk({})).toBe("")
  })
})

describe("normalizeEmail", () => {
  test("trims and lowercases", () =>
    expect(normalizeEmail("  Rohit.Tokala@Jacobs.com ")).toBe(
      "rohit.tokala@jacobs.com"
    ))
  test("null/undefined become empty string", () => {
    expect(normalizeEmail(null)).toBe("")
    expect(normalizeEmail(undefined)).toBe("")
  })
})

describe("sameEmail", () => {
  test("case-insensitive equality", () =>
    expect(sameEmail("A@x.com", "a@X.com")).toBe(true))
  test("empty never matches empty", () => {
    expect(sameEmail("", "")).toBe(false)
    expect(sameEmail(null, undefined)).toBe(false)
  })
  test("distinct emails do not match", () =>
    expect(sameEmail("a@x.com", "b@x.com")).toBe(false))
})

/* ------------------------------------------------------------------ */
/* parseOptions                                                         */
/* ------------------------------------------------------------------ */

describe("parseOptions", () => {
  test("parses a JSON object", () => {
    expect(parseOptions<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
  })
  test("empty object for null/undefined/blank", () => {
    expect(parseOptions(null) as object).toEqual({})
    expect(parseOptions(undefined) as object).toEqual({})
    expect(parseOptions("") as object).toEqual({})
  })
  test("empty object for malformed JSON", () => {
    expect(parseOptions("{not json") as object).toEqual({})
  })
  test("empty object for non-object JSON (primitive / null literal)", () => {
    expect(parseOptions("5") as object).toEqual({})
    expect(parseOptions('"str"') as object).toEqual({})
    expect(parseOptions("null") as object).toEqual({})
  })
})

/* ------------------------------------------------------------------ */
/* linearizeMessagePath (tree walk)                                     */
/* ------------------------------------------------------------------ */

describe("linearizeMessagePath", () => {
  const messages: MessageRow[] = [
    { __primaryKey: "a", content: "a", parentMessageId: "" },
    { __primaryKey: "b", content: "b", parentMessageId: "a" },
    { __primaryKey: "c", content: "c", parentMessageId: "b" },
    { __primaryKey: "d", content: "d", parentMessageId: "a" },
  ]

  test("walks parents from the leaf, returning root→leaf", () => {
    const path = linearizeMessagePath(messages, "c")
    expect(path.map((m) => pk(m))).toEqual(["a", "b", "c"])
  })

  test("follows an alternate sibling branch", () => {
    const path = linearizeMessagePath(messages, "d")
    expect(path.map((m) => pk(m))).toEqual(["a", "d"])
  })

  test("empty when the leaf id is missing or nullish", () => {
    expect(linearizeMessagePath(messages, "nope")).toEqual([])
    expect(linearizeMessagePath(messages, null)).toEqual([])
    expect(linearizeMessagePath(messages, undefined)).toEqual([])
  })

  test("terminates on cycles instead of looping forever", () => {
    const cyclic: MessageRow[] = [
      { __primaryKey: "p", parentMessageId: "q" },
      { __primaryKey: "q", parentMessageId: "p" },
    ]
    const path = linearizeMessagePath(cyclic, "p")
    expect(path.length).toBeLessThanOrEqual(2)
    expect(new Set(path.map((m) => pk(m))).size).toBe(path.length)
  })
})

/* ------------------------------------------------------------------ */
/* serializeDoc                                                         */
/* ------------------------------------------------------------------ */

describe("serializeDoc", () => {
  const doc: DocRow = {
    documentId: "d1",
    fileName: "MSA.pdf",
    userEmail: "rohit.tokala@jacobs.com",
    parentFolderId: "folder-root",
    status: "uploaded",
    uploadTs: "2026-06-01T00:00:00Z",
    mediaItemRid: "ri.mio.main.media-item.abc",
    mime: "application/pdf",
  }

  test("chunk count drives isIndexed and the index status block", () => {
    const s = serializeDoc(doc, {
      indexCounts: {
        chunkCount: 12,
        entityCount: 4,
        relationshipCount: 3,
        pageCount: 27,
        stage: "indexed",
        isSearchable: true,
      },
      userEmail: "rohit.tokala@jacobs.com",
    })
    expect(s.isIndexed).toBe(true)
    expect(s.indexStatus?.isIndexingComplete).toBe(true)
    expect(s.indexStatus?.embeddingCount).toBe(12)
    expect(s.indexStatus?.entityCount).toBe(4)
    expect(s.indexStatus?.kgReady).toBe(true)
    expect(s.noPages).toBe(27)
    expect(s.indexStatus?.noPages).toBe(27)
  })

  test("zero chunks means not indexed; zero entities means KG not ready", () => {
    const s = serializeDoc(doc, {
      indexCounts: {
        chunkCount: 0,
        entityCount: 0,
        relationshipCount: 0,
        pageCount: null,
        stage: null,
        isSearchable: false,
      },
      userEmail: "rohit.tokala@jacobs.com",
    })
    expect(s.isIndexed).toBe(false)
    expect(s.indexStatus?.kgReady).toBe(false)
    expect(s.noPages).toBeNull()
  })

  test("no index counts yields a null index status and not-indexed", () => {
    const s = serializeDoc(doc, { userEmail: "rohit.tokala@jacobs.com" })
    expect(s.isIndexed).toBe(false)
    expect(s.indexStatus).toBeNull()
  })

  test("root folder maps to null folderId; a real folder passes through", () => {
    expect(serializeDoc(doc).folderId).toBeNull()
    expect(
      serializeDoc({ ...doc, parentFolderId: undefined }).folderId
    ).toBeNull()
    expect(serializeDoc({ ...doc, parentFolderId: "f-legal" }).folderId).toBe(
      "f-legal"
    )
  })

  test("flags shared-from-folder when the viewer is not the owner", () => {
    const shared = serializeDoc(doc, {
      userEmail: "someone.else@jacobs.com",
      sharedFolderNames: ["Legal"],
    })
    expect(shared.isSharedFromFolder).toBe(true)
    expect(shared.sharedFolderNames).toEqual(["Legal"])
    const owned = serializeDoc(doc, { userEmail: "rohit.tokala@jacobs.com" })
    expect(owned.isSharedFromFolder).toBe(false)
  })

  test("no viewer email means never shared-from-folder", () => {
    expect(serializeDoc(doc).isSharedFromFolder).toBe(false)
  })

  test("normalizes the owner email and keeps the media rid", () => {
    const s = serializeDoc({ ...doc, userEmail: "Rohit.Tokala@Jacobs.com" })
    expect(s.addedBy).toBe("rohit.tokala@jacobs.com")
    expect(s.mediaItemRid).toBe("ri.mio.main.media-item.abc")
  })
})

/* ------------------------------------------------------------------ */
/* serializeSession                                                     */
/* ------------------------------------------------------------------ */

describe("serializeSession", () => {
  test("parses app state out of the options JSON", () => {
    const row: SessionRow = {
      sessionId: "s1",
      userEmail: "rohit.tokala@jacobs.com",
      title: "Renewals",
      summary: "sum",
      activeLeafMessageId: "leaf-9",
      createdAt: "2026-07-01T00:00:00Z",
      lastUpdatedAt: "2026-07-02T00:00:00Z",
      options: JSON.stringify({
        docsAttached: ["d1", "d2"],
        foldersAttached: ["f1"],
        chatFolderId: "cf-1",
        currentRun: { status: "in_progress", messageId: "m1", startedAt: "t" },
      }),
    }
    const s = serializeSession(row, 5)
    expect(s.rid).toBe("s1")
    expect(s.mode).toBe("regular")
    expect(s.activeLeafMessageId).toBe("leaf-9")
    expect(s.chatFolderId).toBe("cf-1")
    expect(s.docsAttached).toEqual(["d1", "d2"])
    expect(s.foldersAttached).toEqual(["f1"])
    expect(s.metadata.title).toBe("Renewals")
    expect(s.metadata.messageCount).toBe(5)
    expect(s.currentRun.status).toBe("in_progress")
    expect(s.currentRun.messageId).toBe("m1")
  })

  test("defaults cleanly when options is absent or malformed", () => {
    const s = serializeSession({ sessionId: "s2", options: "{bad" })
    expect(s.chatFolderId).toBeNull()
    expect(s.docsAttached).toEqual([])
    expect(s.foldersAttached).toEqual([])
    expect(s.currentRun.status).toBe("idle")
    expect(s.currentRun.error).toBeNull()
    expect(s.metadata.title).toBe("New chat")
    expect(s.activeLeafMessageId).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* serializeMessage                                                     */
/* ------------------------------------------------------------------ */

describe("serializeMessage", () => {
  test("parses citations JSON and normalizes the role", () => {
    const row: MessageRow = {
      messageId: "m1",
      role: "assistant",
      content: "hello",
      parentMessageId: "m0",
      model: "gpt-4o",
      citations: JSON.stringify([{ n: 1, mediaRid: "ri.x" }]),
      scope: JSON.stringify({ documentIds: ["d1"], folderIds: [] }),
      createdAt: "2026-07-01T00:00:00Z",
    }
    const m = serializeMessage(row)
    expect(m.id).toBe("m1")
    expect(m.role).toBe("assistant")
    expect(m.content).toBe("hello")
    expect(m.parentMessageId).toBe("m0")
    expect(m.model).toBe("gpt-4o")
    expect(m.citations).toEqual([{ n: 1, mediaRid: "ri.x" }])
    expect(m.scope).toEqual({ documentIds: ["d1"], folderIds: [] })
  })

  test("unknown roles collapse to user; empty parent becomes null", () => {
    const m = serializeMessage({
      messageId: "m2",
      role: "system",
      content: "q",
      parentMessageId: "",
    })
    expect(m.role).toBe("user")
    expect(m.parentMessageId).toBeNull()
    expect(m.model).toBeNull()
  })

  test("tolerates malformed citations and missing content", () => {
    const m = serializeMessage({ messageId: "m3", citations: "{not json" })
    expect(m.citations).toEqual([])
    expect(m.content).toBe("")
  })

  test("non-array citation JSON is ignored", () => {
    const m = serializeMessage({ messageId: "m4", citations: '{"a":1}' })
    expect(m.citations).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* activeBonusUploads                                                   */
/* ------------------------------------------------------------------ */

describe("activeBonusUploads", () => {
  const now = new Date("2026-07-20T12:00:00Z")

  test("counts a grant whose window contains now", () => {
    const grants: GrantRow[] = [
      {
        bonusUploads: 5,
        validFrom: "2026-07-01T00:00:00Z",
        validUntil: "2026-08-01T00:00:00Z",
      },
    ]
    expect(activeBonusUploads(grants, now)).toBe(5)
  })

  test("excludes expired and future grants", () => {
    const grants: GrantRow[] = [
      {
        bonusUploads: 10,
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2026-02-01T00:00:00Z",
      },
      {
        bonusUploads: 3,
        validFrom: "2026-12-01T00:00:00Z",
        validUntil: "2026-12-31T00:00:00Z",
      },
    ]
    expect(activeBonusUploads(grants, now)).toBe(0)
  })

  test("sums overlapping active grants and coerces string counts", () => {
    const grants: GrantRow[] = [
      {
        bonusUploads: "4",
        validFrom: "2026-07-01T00:00:00Z",
        validUntil: "2026-08-01T00:00:00Z",
      },
      {
        bonusUploads: 6,
        validFrom: "2026-07-10T00:00:00Z",
        validUntil: "2026-07-30T00:00:00Z",
      },
    ]
    expect(activeBonusUploads(grants, now)).toBe(10)
  })

  test("grants with unparseable dates are treated as always-on", () => {
    const grants: GrantRow[] = [
      { bonusUploads: 2, validFrom: "", validUntil: "" },
    ]
    expect(activeBonusUploads(grants, now)).toBe(2)
  })
})
