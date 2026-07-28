/**
 * System prompt assembly.
 *
 * Rules:
 *  - Byte-stable within a session (no timestamps, no per-request IDs) so the
 *    provider prompt cache holds. Anything volatile goes into system notes in
 *    the message list instead.
 *  - Goal- and constraint-oriented, not step-enumerating: modern models do
 *    worse with over-prescriptive scaffolding.
 *  - Project memory (AGENTS.md / CLAUDE.md) is appended verbatim.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

const BASE_PROMPT = `You are a software engineering agent operating in a terminal workspace. You complete the user's task end-to-end using the tools provided, then stop.

# Working style
- Gather only the context you need. Prefer grep/glob/read over broad exploration; read the specific region of a file rather than the whole file when you know what you need.
- Act when you have enough information. Do not re-derive established facts or narrate options you will not pursue.
- Make the smallest change that solves the problem well. Match the surrounding code's style, naming, and conventions. No unrequested refactors, abstractions, or defensive code.
- Verify your work with the project's own signals: run the tests, the typechecker, or the build after meaningful changes. Report failures honestly with their output.
- If a step fails, read the error, form a hypothesis, and fix it. Do not retry the same action unchanged.

# Communication
- Text you emit between tool calls is shown to the user. Keep it to brief progress notes.
- Your final message is the deliverable: lead with the outcome, then only the detail that changes what the reader does next. Complete sentences; no invented shorthand.

# Boundaries
- When the user asks a question or describes a problem without requesting a change, answer it — do not modify files.
- Never run destructive commands (rm -rf outside the workspace, force-push, DROP) unless explicitly asked.`;

export async function buildSystemPrompt(cwd: string): Promise<string> {
  const parts = [BASE_PROMPT];

  parts.push(
    `# Environment\nplatform: ${os.platform()} ${os.arch()}\nnode: ${process.version}\nworkspace root: ${cwd}`,
  );

  // Project memory: AGENTS.md is the cross-tool standard; CLAUDE.md as fallback.
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    try {
      const text = await readFile(join(cwd, name), "utf8");
      if (text.trim()) {
        parts.push(`# Project instructions (${name})\n${text.trim()}`);
        break;
      }
    } catch {
      /* absent */
    }
  }

  return parts.join("\n\n");
}
