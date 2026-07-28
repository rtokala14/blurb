/**
 * Context management: keeping a long-running session inside the model's
 * context window without destroying the prompt-cache prefix more often than
 * necessary.
 *
 * Two mechanisms, cheapest first:
 *
 * 1. Tool-result aging ("prune"): old, large tool results are replaced in
 *    place with a short stub. The model can always re-run the tool — the
 *    filesystem is the real memory. This invalidates the cache prefix from
 *    the edit point, but costs no model call.
 *
 * 2. Compaction ("summarize"): when pruning is not enough, ask the model to
 *    write a structured handoff summary of the transcript, then restart the
 *    message list as [summary, recent tail]. This is a full cache rebuild,
 *    so it is the last resort.
 */

import type { AgentMessage, Provider, ToolResultPart } from "./types.js";

/** Cheap token estimate: ~4 chars/token. Used only for budgeting decisions. */
export function estimateTokens(messages: AgentMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (m.role === "system_note") {
      chars += m.content.length;
      continue;
    }
    for (const p of m.content) {
      if (p.type === "text" || p.type === "thinking") chars += p.text.length;
      else if (p.type === "tool_result") chars += p.content.length;
      else if (p.type === "tool_call") chars += JSON.stringify(p.input).length + 50;
      else chars += 1500; // image
    }
  }
  return Math.ceil(chars / 4);
}

export interface ContextOptions {
  /** Hard budget for the conversation, in estimated tokens. */
  budgetTokens: number;
  /** Start pruning at this fraction of budget. */
  pruneAt?: number;
  /** Compact at this fraction of budget. */
  compactAt?: number;
  /** Tool results older than this many assistant turns are prunable. */
  keepRecentTurns?: number;
  /** Tool results smaller than this are never pruned. */
  minPruneChars?: number;
}

const PRUNE_STUB = (tool: string, chars: number) =>
  `[stale ${tool} result pruned (${chars} chars). Re-run the tool if you need it again.]`;

/**
 * Replace old large tool results with stubs. Mutates a copy; returns the new
 * list and how many were pruned.
 */
export function pruneToolResults(
  messages: AgentMessage[],
  opts: ContextOptions,
): { messages: AgentMessage[]; pruned: number } {
  const keepTurns = opts.keepRecentTurns ?? 3;
  const minChars = opts.minPruneChars ?? 2000;

  // Find the message index before which pruning is allowed: everything except
  // the last `keepTurns` assistant turns.
  let assistantSeen = 0;
  let cutoff = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") {
      assistantSeen++;
      if (assistantSeen >= keepTurns) {
        cutoff = i;
        break;
      }
    }
  }

  let pruned = 0;
  const next = messages.map((m, i) => {
    if (i >= cutoff || m.role !== "user") return m;
    let changed = false;
    const content = m.content.map((p) => {
      if (
        p.type === "tool_result" &&
        p.content.length >= minChars &&
        !p.content.startsWith("[stale ")
      ) {
        changed = true;
        pruned++;
        const stub: ToolResultPart = {
          ...p,
          content: PRUNE_STUB(p.toolName, p.content.length),
        };
        return stub;
      }
      return p;
    });
    return changed ? { ...m, content } : m;
  });
  return { messages: next, pruned };
}

const COMPACT_PROMPT = `Write a handoff summary of this session for another engineer (an AI agent) who will continue the work with NO other context. Include, in this order:
1. Goal: what the user asked for, verbatim where it matters.
2. State: what has been done and verified so far (files created/modified with paths, commands run, test results).
3. Key knowledge: APIs, file locations, conventions, and constraints discovered — anything expensive to rediscover.
4. In progress / next steps: what remains, in priority order, with enough detail to resume mid-step.
5. Pitfalls: dead ends already explored and errors already fixed, so they are not repeated.
Be dense and factual. Do not editorialize. Use paths and identifiers exactly.`;

/**
 * Compact the transcript via a model-written summary. Keeps the last
 * `tailTurns` user/assistant exchanges verbatim after the summary.
 */
export async function compact(
  provider: Provider,
  system: string,
  messages: AgentMessage[],
  opts: { maxTokens?: number; signal?: AbortSignal } = {},
): Promise<AgentMessage[]> {
  const req = {
    model: provider.model,
    system,
    messages: [
      ...messages,
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: COMPACT_PROMPT }],
      },
    ],
    tools: [],
    maxTokens: opts.maxTokens ?? 4000,
  };
  const turn = await provider.stream(req, {}, opts.signal);
  const summary = turn.message.content
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n");

  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `<session-summary>\nThe conversation so far was compacted. Summary:\n\n${summary}\n</session-summary>\nContinue the task from where the summary leaves off.`,
        },
      ],
    },
  ];
}
