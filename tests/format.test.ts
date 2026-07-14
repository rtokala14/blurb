import { describe, expect, test } from "bun:test"

import { buildMailto, markdownToPlainText } from "@/lib/format"

describe("markdownToPlainText", () => {
    test("strips headings, bold, italics and code", () => {
        const md = "# Title\n\nThis is **bold** and *italic* and `code`."
        expect(markdownToPlainText(md)).toBe(
            "Title\n\nThis is bold and italic and code."
        )
    })

    test("turns bullets into • and keeps citation markers", () => {
        const md = "- first [1]\n- second [2]"
        expect(markdownToPlainText(md)).toBe("• first [1]\n• second [2]")
    })

    test("renders links as text (url)", () => {
        expect(markdownToPlainText("See [the doc](https://x.test/a).")).toBe(
            "See the doc (https://x.test/a)."
        )
    })

    test("keeps fenced code content without the fences", () => {
        expect(markdownToPlainText("```ts\nconst a = 1\n```")).toBe("const a = 1")
    })

    test("collapses excess blank lines", () => {
        expect(markdownToPlainText("a\n\n\n\nb")).toBe("a\n\nb")
    })
})

describe("buildMailto", () => {
    test("encodes to, subject and body with %20 spaces", () => {
        const href = buildMailto({
            to: "a@b.com",
            subject: "Hi there",
            body: "line one\nline two",
        })
        expect(href.startsWith("mailto:a%40b.com?")).toBe(true)
        expect(href).toContain("subject=Hi%20there")
        expect(href).toContain("body=line%20one%0Aline%20two")
        // never emit "+" for spaces (some clients render them literally)
        expect(href.includes("+")).toBe(false)
    })

    test("includes cc when provided and omits empty fields", () => {
        const href = buildMailto({ to: "a@b.com", cc: "c@d.com" })
        expect(href).toContain("cc=c%40d.com")
        expect(href).not.toContain("subject=")
        expect(href).not.toContain("body=")
    })

    test("no query string when only recipient is set", () => {
        expect(buildMailto({ to: "a@b.com" })).toBe("mailto:a%40b.com")
    })
})
