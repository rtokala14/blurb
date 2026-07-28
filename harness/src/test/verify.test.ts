import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../agent.js";
import { builtinTools } from "../tools/index.js";
import { MockProvider, textTurn, toolTurn } from "../providers/mock.js";
import type { AgentMessage } from "../types.js";

test("evidence-grounded completion: nudges once when done without verification", async () => {
  const dir = await mkdtemp(join(tmpdir(), "harness-verify-"));
  try {
    await writeFile(join(dir, "f.txt"), "old\n");
    const provider = new MockProvider([
      toolTurn([{ id: "t1", name: "read", input: { path: "f.txt" } }]),
      toolTurn([
        { id: "t2", name: "edit", input: { path: "f.txt", old_string: "old", new_string: "new" } },
      ]),
      // model claims done without running anything
      textTurn("All done!"),
      // after the nudge it verifies and finishes
      (req) => {
        const note = req.messages.find((m: AgentMessage) => m.role === "system_note");
        assert.ok(note, "expected a system_note nudge");
        return toolTurn([{ id: "t3", name: "bash", input: { command: "true" } }]);
      },
      textTurn("Verified, done."),
    ]);
    const agent = new Agent({ provider, tools: builtinTools, system: "s", cwd: dir });
    const result = await agent.run("edit f.txt");
    assert.equal(result.finalText, "Verified, done.");
    assert.equal(provider.requests.length, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no nudge when verification already ran", async () => {
  const dir = await mkdtemp(join(tmpdir(), "harness-verify2-"));
  try {
    await writeFile(join(dir, "f.txt"), "old\n");
    const provider = new MockProvider([
      toolTurn([{ id: "t1", name: "read", input: { path: "f.txt" } }]),
      toolTurn([
        { id: "t2", name: "edit", input: { path: "f.txt", old_string: "old", new_string: "new" } },
        { id: "t3", name: "bash", input: { command: "true" } },
      ]),
      textTurn("Done."),
    ]);
    const agent = new Agent({ provider, tools: builtinTools, system: "s", cwd: dir });
    const result = await agent.run("edit f.txt");
    assert.equal(result.finalText, "Done.");
    assert.equal(provider.requests.length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
