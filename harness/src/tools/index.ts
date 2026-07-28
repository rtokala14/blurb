/**
 * Built-in tool suite.
 *
 * Design principles (see DESIGN.md):
 *  - Small, orthogonal set: bash + read/write/edit + grep/glob. Everything
 *    else goes through bash.
 *  - Tools that only read are marked readOnly and run in parallel.
 *  - Edit enforces read-before-write and staleness checks — invariants bash
 *    can't provide.
 *  - Outputs are token-budgeted: every tool truncates with an explicit marker
 *    telling the model how to get more, never silently.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { dirname, resolve, isAbsolute, relative } from "node:path";
import type { Tool, ToolContext, ToolOutput } from "../types.js";
import { walkFiles, globToRegExp } from "./fswalk.js";

const MAX_OUTPUT_CHARS = 40_000; // ~10k tokens ceiling per tool result

function truncate(s: string, limit = MAX_OUTPUT_CHARS): string {
  if (s.length <= limit) return s;
  const half = Math.floor(limit / 2);
  return (
    s.slice(0, half) +
    `\n\n[... output truncated: ${s.length - limit} chars omitted. Narrow the request (offset/limit, tighter pattern, head/tail) to see more ...]\n\n` +
    s.slice(-half)
  );
}

function resolveSafe(cwd: string, p: string): string {
  const full = isAbsolute(p) ? p : resolve(cwd, p);
  const rel = relative(cwd, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`path escapes workspace root: ${p}`);
  }
  return full;
}

const ok = (content: string): ToolOutput => ({ content });
const err = (content: string): ToolOutput => ({ content, isError: true });

// ---------------------------------------------------------------------------

export const bashTool: Tool = {
  readOnly: false,
  def: {
    name: "bash",
    description:
      "Run a shell command in the workspace root. Use for builds, tests, git, package managers, and anything without a dedicated tool. Prefer read/grep/glob for file inspection (they are faster and parallel-safe). Output is capped; pipe through head/tail for large output.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run" },
        timeout_ms: {
          type: "number",
          description: "Max runtime in ms (default 120000, max 600000)",
        },
      },
      required: ["command"],
    },
  },
  async execute(input, ctx): Promise<ToolOutput> {
    const command = String(input.command ?? "");
    if (!command) return err("no command provided");
    const timeout = Math.min(Number(input.timeout_ms) || 120_000, 600_000);
    return new Promise((resolvePromise) => {
      const child = spawn("bash", ["-c", command], {
        cwd: ctx.cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      const cap = (chunk: Buffer) => {
        if (out.length < MAX_OUTPUT_CHARS * 2) out += chunk.toString();
      };
      child.stdout.on("data", cap);
      child.stderr.on("data", cap);
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolvePromise(err(`command timed out after ${timeout}ms\n${truncate(out)}`));
      }, timeout);
      const onAbort = () => child.kill("SIGKILL");
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      child.on("close", (code) => {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", onAbort);
        const body = truncate(out.trim() || "(no output)");
        resolvePromise(
          code === 0 ? ok(body) : err(`exit code ${code}\n${body}`),
        );
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        resolvePromise(err(`spawn failed: ${e.message}`));
      });
    });
  },
};

// ---------------------------------------------------------------------------

export const readTool: Tool = {
  readOnly: true,
  def: {
    name: "read",
    description:
      "Read a text file. Returns numbered lines. Use offset/limit for large files — reading only the region you need keeps context small.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "number", description: "1-based first line (default 1)" },
        limit: { type: "number", description: "max lines (default 1500)" },
      },
      required: ["path"],
    },
  },
  async execute(input, ctx): Promise<ToolOutput> {
    try {
      const full = resolveSafe(ctx.cwd, String(input.path));
      const st = await stat(full);
      if (st.size > 5_000_000) return err(`file too large (${st.size} bytes); use bash with head/grep`);
      const text = await readFile(full, "utf8");
      ctx.readFiles.set(full, st.mtimeMs);
      const lines = text.split("\n");
      const offset = Math.max(1, Number(input.offset) || 1);
      const limit = Math.min(Number(input.limit) || 1500, 5000);
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      const numbered = slice
        .map((l, i) => `${String(offset + i).padStart(5)}\t${l}`)
        .join("\n");
      const remaining = lines.length - (offset - 1 + slice.length);
      return ok(
        truncate(numbered) +
          (remaining > 0 ? `\n[... ${remaining} more lines; re-read with offset=${offset + slice.length}]` : ""),
      );
    } catch (e) {
      return err(String((e as Error).message ?? e));
    }
  },
};

// ---------------------------------------------------------------------------

export const writeTool: Tool = {
  readOnly: false,
  def: {
    name: "write",
    description:
      "Create or overwrite a file with the given content. For partial changes to an existing file, use edit instead. Overwriting an existing file requires reading it first.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  async execute(input, ctx): Promise<ToolOutput> {
    try {
      const full = resolveSafe(ctx.cwd, String(input.path));
      const exists = await stat(full).then(() => true, () => false);
      if (exists && !ctx.readFiles.has(full)) {
        return err(`refusing to overwrite ${input.path}: read it first`);
      }
      await mkdir(dirname(full), { recursive: true });
      const content = String(input.content ?? "");
      await writeFile(full, content, "utf8");
      const st = await stat(full);
      ctx.readFiles.set(full, st.mtimeMs);
      return ok(`wrote ${content.length} chars to ${input.path}`);
    } catch (e) {
      return err(String((e as Error).message ?? e));
    }
  },
};

// ---------------------------------------------------------------------------

export const editTool: Tool = {
  readOnly: false,
  def: {
    name: "edit",
    description:
      "Exact string replacement in a file. old_string must match exactly once (include enough surrounding context to be unique), or pass replace_all=true. The file must have been read this session and not modified since.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  async execute(input, ctx): Promise<ToolOutput> {
    try {
      const full = resolveSafe(ctx.cwd, String(input.path));
      const readMtime = ctx.readFiles.get(full);
      if (readMtime == null) return err(`read ${input.path} before editing it`);
      const st = await stat(full);
      if (st.mtimeMs !== readMtime) {
        return err(`${input.path} changed on disk since you read it; re-read it first`);
      }
      const text = await readFile(full, "utf8");
      const oldStr = String(input.old_string);
      const newStr = String(input.new_string);
      if (oldStr === newStr) return err("old_string and new_string are identical");
      const count = text.split(oldStr).length - 1;
      if (count === 0) return err(`old_string not found in ${input.path}`);
      if (count > 1 && !input.replace_all) {
        return err(
          `old_string occurs ${count} times; add surrounding context to make it unique or set replace_all=true`,
        );
      }
      const next = input.replace_all
        ? text.split(oldStr).join(newStr)
        : text.replace(oldStr, newStr);
      await writeFile(full, next, "utf8");
      const st2 = await stat(full);
      ctx.readFiles.set(full, st2.mtimeMs);
      return ok(`replaced ${input.replace_all ? count : 1} occurrence(s) in ${input.path}`);
    } catch (e) {
      return err(String((e as Error).message ?? e));
    }
  },
};

// ---------------------------------------------------------------------------

export const grepTool: Tool = {
  readOnly: true,
  def: {
    name: "grep",
    description:
      "Regex search across files in the workspace. Returns matching lines as path:line:text. Filter with the glob parameter (e.g. '**/*.ts').",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript regular expression" },
        glob: { type: "string", description: "Only search files matching this glob" },
        max_results: { type: "number", description: "default 200" },
      },
      required: ["pattern"],
    },
  },
  async execute(input, ctx): Promise<ToolOutput> {
    let re: RegExp;
    try {
      re = new RegExp(String(input.pattern));
    } catch (e) {
      return err(`invalid regex: ${(e as Error).message}`);
    }
    const globRe = input.glob ? globToRegExp(String(input.glob)) : null;
    const maxResults = Math.min(Number(input.max_results) || 200, 1000);
    const results: string[] = [];
    let searched = 0;
    for await (const rel of walkFiles(ctx.cwd)) {
      if (ctx.signal.aborted) break;
      if (globRe && !globRe.test(rel)) continue;
      searched++;
      let text: string;
      try {
        const full = resolve(ctx.cwd, rel);
        const st = await stat(full);
        if (st.size > 2_000_000) continue;
        text = await readFile(full, "utf8");
      } catch {
        continue;
      }
      if (text.includes("\u0000")) continue; // binary
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
          results.push(`${rel}:${i + 1}:${lines[i]!.slice(0, 300)}`);
          if (results.length >= maxResults) {
            return ok(
              truncate(results.join("\n")) +
                `\n[... hit max_results=${maxResults}; tighten the pattern or glob]`,
            );
          }
        }
      }
    }
    return ok(
      results.length
        ? truncate(results.join("\n"))
        : `no matches for /${input.pattern}/ in ${searched} files`,
    );
  },
};

// ---------------------------------------------------------------------------

export const globTool: Tool = {
  readOnly: true,
  def: {
    name: "glob",
    description:
      "List files matching a glob pattern (e.g. 'src/**/*.ts'), sorted by most recently modified.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
      },
      required: ["pattern"],
    },
  },
  async execute(input, ctx): Promise<ToolOutput> {
    const re = globToRegExp(String(input.pattern));
    const matches: Array<{ path: string; mtime: number }> = [];
    for await (const rel of walkFiles(ctx.cwd)) {
      if (ctx.signal.aborted) break;
      if (!re.test(rel)) continue;
      try {
        const st = await stat(resolve(ctx.cwd, rel));
        matches.push({ path: rel, mtime: st.mtimeMs });
      } catch {
        /* ignore */
      }
      if (matches.length >= 2000) break;
    }
    matches.sort((a, b) => b.mtime - a.mtime);
    return ok(
      matches.length
        ? truncate(matches.map((m) => m.path).join("\n"))
        : `no files match ${input.pattern}`,
    );
  },
};

export const builtinTools: Tool[] = [
  bashTool,
  readTool,
  writeTool,
  editTool,
  grepTool,
  globTool,
];
