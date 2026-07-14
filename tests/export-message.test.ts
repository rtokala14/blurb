import { describe, expect, test } from "bun:test"

import { parseBlocks } from "@/lib/export-message"

describe("parseBlocks — tables", () => {
    test("parses a GitHub pipe table into header + body rows", () => {
        const md = "| Name | Role |\n| --- | --- |\n| Ada | Eng |\n| Bo | PM |"
        const blocks = parseBlocks(md)
        expect(blocks).toHaveLength(1)
        const table = blocks[0]
        expect(table.kind).toBe("table")
        expect(table.rows).toBeDefined()
        expect(table.rows).toHaveLength(3) // header + 2 body rows
        // header cells
        expect(table.rows![0].map((cell) => cell.map((r) => r.text).join(""))).toEqual([
            "Name",
            "Role",
        ])
        // body row
        expect(table.rows![2].map((cell) => cell.map((r) => r.text).join(""))).toEqual([
            "Bo",
            "PM",
        ])
    })

    test("handles leading/trailing pipes and alignment colons", () => {
        const md = "| A | B |\n|:---|---:|\n| 1 | 2 |"
        const [table] = parseBlocks(md)
        expect(table.kind).toBe("table")
        expect(table.rows).toHaveLength(2)
    })

    test("preserves inline formatting inside cells", () => {
        const md = "| Item | Note |\n| --- | --- |\n| **bold** | `code` |"
        const [table] = parseBlocks(md)
        const [name, note] = table.rows![1]
        expect(name[0]).toMatchObject({ text: "bold", bold: true })
        expect(note[0]).toMatchObject({ text: "code", code: true })
    })

    test("a table without a separator row stays a paragraph", () => {
        const md = "| just | text |\n| more | text |"
        const [block] = parseBlocks(md)
        expect(block.kind).toBe("p")
    })

    test("non-table markdown still parses normally", () => {
        const blocks = parseBlocks("# Heading\n\nA paragraph.\n\n- one\n- two")
        expect(blocks[0].kind).toBe("heading")
        expect(blocks[1].kind).toBe("p")
        expect(blocks[2].kind).toBe("li")
    })
})
