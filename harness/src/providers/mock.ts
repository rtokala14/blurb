/**
 * Scripted provider for tests and offline development. Each call to stream()
 * pops the next scripted turn; the script can also be a function of the
 * request, for assertions on what the loop sends.
 */

import type {
  AssistantTurn,
  Provider,
  ProviderRequest,
  StreamHandlers,
} from "../types.js";

export type MockTurn =
  | AssistantTurn
  | ((req: ProviderRequest) => AssistantTurn);

export class MockProvider implements Provider {
  readonly name = "mock";
  readonly model = "mock-model";
  requests: ProviderRequest[] = [];
  private script: MockTurn[];

  constructor(script: MockTurn[]) {
    this.script = [...script];
  }

  async stream(
    req: ProviderRequest,
    handlers: StreamHandlers,
  ): Promise<AssistantTurn> {
    this.requests.push(structuredClone(req));
    const next = this.script.shift();
    if (!next) throw new Error("mock script exhausted");
    const turn = typeof next === "function" ? next(req) : next;
    for (const p of turn.message.content) {
      if (p.type === "text") handlers.onText?.(p.text);
    }
    return turn;
  }
}

export const textTurn = (text: string): AssistantTurn => ({
  message: { role: "assistant", content: [{ type: "text", text }] },
  stopReason: "end_turn",
  usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
});

export const toolTurn = (
  calls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  text = "",
): AssistantTurn => ({
  message: {
    role: "assistant",
    content: [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...calls.map((c) => ({ type: "tool_call" as const, ...c })),
    ],
  },
  stopReason: "tool_use",
  usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
});
