import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../agent.js";
import { builtinTools } from "../tools/index.js";
import { MockProvider, textTurn, toolTurn } from "../providers/mock.js";
import { estimateTokens, pruneToolResults } from "../context.js";
import type { AgentMessage } from "../types.js";

test("agent loop: read -> edit -> done, results threaded back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "harness-agent-"));
  try {
    await writeFile(join(dir, "greet.txt"), "hello world\n");

    const provider = new MockProvider([
      toolTurn([{ id: "t1", name: "read", input: { path: "greet.txt" } }]),
      toolTurn([
        {
          id: "t2",
          name: "edit",
          input: { path: "greet.txt", old_string: "hello", new_string: "hi" },
        },
        // verification alongside the edit, so no completion nudge fires
        { id: "t3", name: "bash", input: { command: "cat greet.txt" } },
      ]),
      textTurn("Done: replaced greeting."),
    ]);

    const agent = new Agent({
      provider,
      tools: builtinTools,
      system: "test system",
      cwd: dir,
    });
    const result = await agent.run("change hello to hi in greet.txt");

    assert.equal(result.stopReason, "end_turn");
    assert.equal(result.finalText, "Done: replaced greeting.");
    assert.equal(await readFile(join(dir, "greet.txt"), "utf8"), "hi world\n");

    // second request must contain the read tool_result
    const req2 = provider.requests[1]!;
    const lastMsg = req2.messages[req2.messages.length - 1]!;
    assert.equal(lastMsg.role, "user");
    const tr = (lastMsg as Extract<AgentMessage, { role: "user" }>).content[0]!;
    assert.equal(tr.type, "tool_result");
    assert.ok((tr as { content: string }).content.includes("hello world"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("agent loop: parallel read-only calls all get results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "harness-par-"));
  try {
    await writeFile(join(dir, "a.txt"), "alpha\n");
    await writeFile(join(dir, "b.txt"), "beta\n");
    const provider = new MockProvider([
      toolTurn([
        { id: "t1", name: "read", input: { path: "a.txt" } },
        { id: "t2", name: "read", input: { path: "b.txt" } },
      ]),
      (req) => {
        const last = req.messages[req.messages.length - 1]!;
        assert.equal(last.role, "user");
        const parts = (last as Extract<AgentMessage, { role: "user" }>).content;
        assert.equal(parts.length, 2);
        assert.equal((parts[0] as { toolCallId: string }).toolCallId, "t1");
        assert.equal((parts[1] as { toolCallId: string }).toolCallId, "t2");
        return textTurn("ok");
      },
    ]);
    const agent = new Agent({ provider, tools: builtinTools, system: "s", cwd: dir });
    const result = await agent.run("read both");
    assert.equal(result.finalText, "ok");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pruning replaces old large tool results, keeps recent turns", () => {
  const big = "x".repeat(5000);
  const messages: AgentMessage[] = [];
  for (let i = 0; i < 6; i++) {
    messages.push({
      role: "assistant",
      content: [{ type: "tool_call", id: `t${i}`, name: "read", input: {} }],
    });
    messages.push({
      role: "user",
      content: [
        { type: "tool_result", toolCallId: `t${i}`, toolName: "read", content: big },
      ],
    });
  }
  const before = estimateTokens(messages);
  const { messages: after, pruned } = pruneToolResults(messages, {
    budgetTokens: 100_000,
    keepRecentTurns: 3,
    minPruneChars: 2000,
  });
  assert.ok(pruned >= 2, `expected >=2 pruned, got ${pruned}`);
  assert.ok(estimateTokens(after) < before);
  // most recent tool result untouched
  const last = after[after.length - 1]!;
  const part = (last as Extract<AgentMessage, { role: "user" }>).content[0]!;
  assert.equal((part as { content: string }).content, big);
});

test("agent caps unknown tools with an error result", async () => {
  const provider = new MockProvider([
    toolTurn([{ id: "t1", name: "nope", input: {} }]),
    (req) => {
      const last = req.messages[req.messages.length - 1]!;
      const part = (last as Extract<AgentMessage, { role: "user" }>).content[0]!;
      assert.match((part as { content: string }).content, /unknown tool/);
      return textTurn("recovered");
    },
  ]);
  const agent = new Agent({ provider, tools: builtinTools, system: "s", cwd: "/tmp" });
  const result = await agent.run("x");
  assert.equal(result.finalText, "recovered");
});
