/**
 * The agent loop.
 *
 * Deliberately a single flat loop (no planner/executor split): model produces
 * a turn; if it called tools, run them (read-only calls in parallel), append
 * results, repeat. Context management runs between turns: batched tool-result
 * pruning first (cheap, amortizes cache invalidation), model-written
 * compaction only as a last resort.
 */

import type {
  AgentEvent,
  AgentMessage,
  AssistantTurn,
  Provider,
  Tool,
  ToolCallPart,
  ToolContext,
  ToolResultPart,
  UserMessage,
} from "./types.js";
import {
  compact,
  estimateTokens,
  pruneToolResults,
  type ContextOptions,
} from "./context.js";

export interface AgentOptions {
  provider: Provider;
  tools: Tool[];
  system: string;
  cwd: string;
  maxTurns?: number;
  maxTokensPerTurn?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  context?: Partial<ContextOptions>;
  onEvent?: (ev: AgentEvent) => void;
  signal?: AbortSignal;
}

export interface AgentResult {
  messages: AgentMessage[];
  finalText: string;
  turns: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  stopReason: string;
}

const MUTATING_TOOLS = new Set(["write", "edit"]);
const VERIFYING_TOOLS = new Set(["bash"]);

export class Agent {
  private messages: AgentMessage[] = [];
  private readFiles = new Map<string, number>();
  private toolsByName: Map<string, Tool>;
  private opts: AgentOptions;
  private ctxOpts: ContextOptions;
  /** Evidence-grounded completion state (see DESIGN.md). */
  private unverifiedMutation = false;
  private verifyNudgeUsed = false;

  constructor(opts: AgentOptions) {
    this.opts = opts;
    this.toolsByName = new Map(opts.tools.map((t) => [t.def.name, t]));
    this.ctxOpts = {
      budgetTokens: opts.context?.budgetTokens ?? 160_000,
      pruneAt: opts.context?.pruneAt ?? 0.5,
      compactAt: opts.context?.compactAt ?? 0.8,
      keepRecentTurns: opts.context?.keepRecentTurns ?? 3,
      minPruneChars: opts.context?.minPruneChars ?? 2000,
    };
  }

  /** Inject harness-side steering between turns without touching the system prompt. */
  addSystemNote(content: string): void {
    this.messages.push({ role: "system_note", content });
  }

  async run(userInput: string): Promise<AgentResult> {
    const emit = this.opts.onEvent ?? (() => {});
    const signal = this.opts.signal ?? new AbortController().signal;
    const maxTurns = this.opts.maxTurns ?? 80;

    const user: UserMessage = {
      role: "user",
      content: [{ type: "text", text: userInput }],
    };
    this.messages.push(user);

    const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let finalText = "";
    let stopReason = "max_turns";

    for (let turn = 1; turn <= maxTurns; turn++) {
      if (signal.aborted) {
        stopReason = "aborted";
        break;
      }
      await this.manageContext(emit, signal);
      emit({ type: "turn_start", turn });

      let result: AssistantTurn;
      try {
        result = await this.opts.provider.stream(
          {
            model: this.opts.provider.model,
            system: this.opts.system,
            messages: this.messages,
            tools: this.opts.tools.map((t) => t.def),
            maxTokens: this.opts.maxTokensPerTurn ?? 16_000,
            effort: this.opts.effort,
          },
          {
            onText: (d) => emit({ type: "text", text: d }),
            onThinking: (d) => emit({ type: "thinking", text: d }),
          },
          signal,
        );
      } catch (e) {
        stopReason = "error";
        finalText = `provider error: ${(e as Error).message}`;
        break;
      }

      totals.inputTokens += result.usage.inputTokens;
      totals.outputTokens += result.usage.outputTokens;
      totals.cacheReadTokens += result.usage.cacheReadTokens;
      totals.cacheWriteTokens += result.usage.cacheWriteTokens;
      this.messages.push(result.message);
      emit({ type: "turn_end", stopReason: result.stopReason, usage: result.usage });

      const text = result.message.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (text) finalText = text;

      const calls = result.message.content.filter(
        (p): p is ToolCallPart => p.type === "tool_call",
      );
      if (result.stopReason !== "tool_use" || calls.length === 0) {
        // Evidence-grounded completion: files were mutated this run but no
        // command ran afterwards — the model is claiming "done" without
        // evidence. Nudge once (deterministic harness check, no LLM cost).
        if (
          result.stopReason === "end_turn" &&
          this.unverifiedMutation &&
          !this.verifyNudgeUsed
        ) {
          this.verifyNudgeUsed = true;
          this.addSystemNote(
            "You modified files but have not run any command since the last modification. Verify the change with the project's own signals (tests, typechecker, build) and report the result — or state explicitly why verification is not possible — before finishing.",
          );
          continue;
        }
        stopReason = result.stopReason;
        break;
      }

      const results = await this.executeToolCalls(calls, emit, signal);
      this.messages.push({ role: "user", content: results });
    }

    emit({ type: "done", reason: stopReason });
    return {
      messages: this.messages,
      finalText,
      turns: this.messages.filter((m) => m.role === "assistant").length,
      usage: totals,
      stopReason,
    };
  }

  /**
   * Execute a turn's tool calls. Consecutive read-only calls run in parallel;
   * a mutating call is a barrier (runs alone, in order).
   */
  private async executeToolCalls(
    calls: ToolCallPart[],
    emit: (ev: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<ToolResultPart[]> {
    const ctx: ToolContext = {
      cwd: this.opts.cwd,
      signal,
      readFiles: this.readFiles,
      log: () => {},
    };

    const runOne = async (call: ToolCallPart): Promise<ToolResultPart> => {
      const tool = this.toolsByName.get(call.name);
      const started = Date.now();
      emit({ type: "tool_start", name: call.name, input: call.input });
      let output;
      if (!tool) {
        output = { content: `unknown tool: ${call.name}`, isError: true };
      } else {
        try {
          output = await tool.execute(call.input, ctx);
        } catch (e) {
          output = { content: `tool crashed: ${(e as Error).message}`, isError: true };
        }
      }
      if (MUTATING_TOOLS.has(call.name) && !output.isError) {
        this.unverifiedMutation = true;
      } else if (VERIFYING_TOOLS.has(call.name)) {
        this.unverifiedMutation = false;
      }
      emit({ type: "tool_end", name: call.name, output, durationMs: Date.now() - started });
      return {
        type: "tool_result",
        toolCallId: call.id,
        toolName: call.name,
        content: output.content,
        isError: output.isError,
      };
    };

    const results: ToolResultPart[] = new Array(calls.length);
    let i = 0;
    while (i < calls.length) {
      const tool = this.toolsByName.get(calls[i]!.name);
      if (tool?.readOnly) {
        // batch consecutive read-only calls
        let j = i;
        while (j < calls.length && this.toolsByName.get(calls[j]!.name)?.readOnly) j++;
        const batch = calls.slice(i, j);
        const settled = await Promise.all(batch.map(runOne));
        settled.forEach((r, k) => (results[i + k] = r));
        i = j;
      } else {
        results[i] = await runOne(calls[i]!);
        i++;
      }
    }
    return results;
  }

  private async manageContext(
    emit: (ev: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const { budgetTokens, pruneAt, compactAt } = this.ctxOpts;
    let tokens = estimateTokens(this.messages);

    if (tokens > budgetTokens * (pruneAt ?? 0.5)) {
      const { messages, pruned } = pruneToolResults(this.messages, this.ctxOpts);
      if (pruned > 0) {
        this.messages = messages;
        tokens = estimateTokens(this.messages);
      }
    }

    if (tokens > budgetTokens * (compactAt ?? 0.8)) {
      emit({ type: "compaction", beforeTokens: tokens });
      this.messages = await compact(
        this.opts.provider,
        this.opts.system,
        this.messages,
        { signal },
      );
    }
  }
}
