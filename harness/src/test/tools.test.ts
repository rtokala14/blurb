import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readTool,
  writeTool,
  editTool,
  grepTool,
  globTool,
  bashTool,
} from "../tools/index.js";
import { globToRegExp } from "../tools/fswalk.js";
import type { ToolContext } from "../types.js";

async function makeCtx(): Promise<ToolContext & { cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "harness-test-"));
  return {
    cwd: dir,
    signal: new AbortController().signal,
    readFiles: new Map(),
    log: () => {},
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test("globToRegExp", () => {
  assert.ok(globToRegExp("**/*.ts").test("src/deep/a.ts"));
  assert.ok(globToRegExp("**/*.ts").test("a.ts"));
  assert.ok(!globToRegExp("**/*.ts").test("a.tsx"));
  assert.ok(globToRegExp("src/*.{ts,tsx}").test("src/a.tsx"));
  assert.ok(!globToRegExp("src/*.ts").test("src/deep/a.ts"));
});

test("read/write/edit roundtrip with staleness protection", async () => {
  const ctx = await makeCtx();
  try {
    // write new file (no prior read needed)
    let out = await writeTool.execute(
      { path: "a.txt", content: "hello world\nsecond line\n" },
      ctx,
    );
    assert.ok(!out.isError, out.content);

    // overwrite without read of an *unread* existing file is refused
    ctx.readFiles.clear();
    out = await writeTool.execute({ path: "a.txt", content: "clobber" }, ctx);
    assert.ok(out.isError);

    // read then edit
    out = await readTool.execute({ path: "a.txt" }, ctx);
    assert.ok(out.content.includes("hello world"));
    out = await editTool.execute(
      { path: "a.txt", old_string: "hello", new_string: "goodbye" },
      ctx,
    );
    assert.ok(!out.isError, out.content);
    assert.equal(
      await readFile(join(ctx.cwd, "a.txt"), "utf8"),
      "goodbye world\nsecond line\n",
    );

    // external modification is detected
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(ctx.cwd, "a.txt"), "changed externally");
    out = await editTool.execute(
      { path: "a.txt", old_string: "goodbye", new_string: "x" },
      ctx,
    );
    assert.ok(out.isError);
    assert.match(out.content, /changed on disk/);

    // ambiguous edit is refused
    await writeFile(join(ctx.cwd, "b.txt"), "aa aa");
    await readTool.execute({ path: "b.txt" }, ctx);
    out = await editTool.execute(
      { path: "b.txt", old_string: "aa", new_string: "bb" },
      ctx,
    );
    assert.ok(out.isError);
    assert.match(out.content, /2 times/);

    // path escape is refused
    out = await readTool.execute({ path: "../../etc/passwd" }, ctx);
    assert.ok(out.isError);
  } finally {
    await ctx.cleanup();
  }
});

test("grep and glob", async () => {
  const ctx = await makeCtx();
  try {
    await writeFile(join(ctx.cwd, "one.ts"), "const needle = 1;\n");
    await writeFile(join(ctx.cwd, "two.md"), "needle in text\n");
    let out = await grepTool.execute({ pattern: "needle", glob: "**/*.ts" }, ctx);
    assert.ok(out.content.includes("one.ts:1:"));
    assert.ok(!out.content.includes("two.md"));

    out = await globTool.execute({ pattern: "**/*.md" }, ctx);
    assert.equal(out.content.trim(), "two.md");
  } finally {
    await ctx.cleanup();
  }
});

test("bash runs and reports failure", async () => {
  const ctx = await makeCtx();
  try {
    let out = await bashTool.execute({ command: "echo hi" }, ctx);
    assert.equal(out.content, "hi");
    out = await bashTool.execute({ command: "exit 3" }, ctx);
    assert.ok(out.isError);
    assert.match(out.content, /exit code 3/);
  } finally {
    await ctx.cleanup();
  }
});
