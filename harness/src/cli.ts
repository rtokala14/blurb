#!/usr/bin/env node
/**
 * Minimal interactive CLI for the harness.
 *
 * Usage:
 *   blurb "fix the failing test"                       # Anthropic (default)
 *   blurb --provider openai --base-url http://localhost:11434/v1 --model qwen3 "..."
 *   blurb            # no prompt -> interactive REPL
 *
 * Env: ANTHROPIC_API_KEY / OPENAI_API_KEY, BLURB_MODEL, BLURB_BASE_URL, BLURB_PROVIDER
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Agent } from "./agent.js";
import { builtinTools } from "./tools/index.js";
import { buildSystemPrompt } from "./prompt.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAiCompatProvider } from "./providers/openai.js";
import type { AgentEvent, Provider } from "./types.js";

interface CliArgs {
  provider: string;
  model: string;
  baseUrl?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  prompt?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    provider: process.env.BLURB_PROVIDER ?? "anthropic",
    model: process.env.BLURB_MODEL ?? "claude-opus-5",
    baseUrl: process.env.BLURB_BASE_URL,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--provider") args.provider = argv[++i] ?? args.provider;
    else if (a === "--model") args.model = argv[++i] ?? args.model;
    else if (a === "--base-url") args.baseUrl = argv[++i];
    else if (a === "--effort") args.effort = argv[++i] as CliArgs["effort"];
    else rest.push(a);
  }
  if (rest.length) args.prompt = rest.join(" ");
  return args;
}

function makeProvider(args: CliArgs): Provider {
  if (args.provider === "anthropic") {
    return new AnthropicProvider({ model: args.model, baseUrl: args.baseUrl });
  }
  if (!args.baseUrl) {
    throw new Error("--base-url is required for the openai provider");
  }
  return new OpenAiCompatProvider({
    model: args.model,
    baseUrl: args.baseUrl,
    supportsReasoningEffort: args.provider === "openai",
  });
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

function renderEvent(ev: AgentEvent): void {
  switch (ev.type) {
    case "text":
      stdout.write(ev.text);
      break;
    case "thinking":
      break; // suppressed by default
    case "tool_start":
      stdout.write(
        `\n${dim(`⏺ ${ev.name} ${summarizeInput(ev.input)}`)}\n`,
      );
      break;
    case "tool_end":
      if (ev.output.isError) {
        stdout.write(dim(`  ⚠ ${firstLine(ev.output.content)}\n`));
      }
      break;
    case "compaction":
      stdout.write(dim(`\n[compacting context: ~${ev.beforeTokens} tokens]\n`));
      break;
    case "turn_end":
      break;
    case "done":
      stdout.write("\n");
      break;
  }
}

const firstLine = (s: string) => s.split("\n", 1)[0]!.slice(0, 120);
const summarizeInput = (input: Record<string, unknown>) => {
  const s = JSON.stringify(input);
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const provider = makeProvider(args);
  const system = await buildSystemPrompt(cwd);

  const abort = new AbortController();
  process.on("SIGINT", () => {
    abort.abort();
    process.exit(130);
  });

  const agent = new Agent({
    provider,
    tools: builtinTools,
    system,
    cwd,
    effort: args.effort,
    onEvent: renderEvent,
    signal: abort.signal,
  });

  if (args.prompt) {
    const result = await agent.run(args.prompt);
    stdout.write(
      dim(
        `\n[${result.turns} turns | in ${result.usage.inputTokens} (cache ${result.usage.cacheReadTokens}) out ${result.usage.outputTokens} | ${result.stopReason}]\n`,
      ),
    );
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  stdout.write(bold(`blurb harness — ${provider.name}:${provider.model}\n`));
  while (true) {
    const line = (await rl.question(bold("> "))).trim();
    if (!line) continue;
    if (line === "/exit" || line === "/quit") break;
    await agent.run(line);
  }
  rl.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
