/** Shared recursive file walker with default ignores. */

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "target",
  "__pycache__",
  ".venv",
  "venv",
]);

export async function* walkFiles(
  root: string,
  opts: { maxFiles?: number } = {},
): AsyncGenerator<string> {
  const maxFiles = opts.maxFiles ?? 20_000;
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== "." && DEFAULT_IGNORES.has(e.name)) continue;
      if (DEFAULT_IGNORES.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        yield relative(root, full);
        if (++count >= maxFiles) return;
      }
    }
  }
}

/** Convert a glob pattern to a RegExp. Supports **, *, ?, {a,b}. */
export function globToRegExp(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` matches zero or more path segments; bare `**` matches anything
        if (pattern[i + 2] === "/") {
          re += "(?:[^/]+/)*";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
        i += 1;
      } else {
        const alts = pattern.slice(i + 1, end).split(",");
        re += "(?:" + alts.map(escapeRe).join("|") + ")";
        i = end + 1;
      }
    } else {
      re += escapeRe(c);
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
