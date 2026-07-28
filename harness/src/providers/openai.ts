/**
 * OpenAI-compatible chat completions adapter (streaming).
 *
 * Works against OpenAI itself and OpenAI-compatible servers (vLLM, SGLang,
 * Ollama, llama.cpp, OpenRouter, Together, Groq, Fireworks, ...). Quirks
 * handled here:
 *  - tool calls stream as fragmented deltas keyed by index
 *  - reasoning models may emit `reasoning_content` (DeepSeek/Qwen/vLLM
 *    convention) or `reasoning`; both are captured as ThinkingParts and
 *    echoed back on subsequent turns
 *  - usage arrives via stream_options: {include_usage: true} on the final chunk
 */

import { parseSse } from "../sse.js";
import { fetchWithRetry } from "../http.js";
import type {
  AgentMessage,
  AssistantPart,
  AssistantTurn,
  Provider,
  ProviderRequest,
  StopReason,
  StreamHandlers,
  ToolCallPart,
} from "../types.js";

export interface OpenAiOptions {
  apiKey?: string;
  /** e.g. https://api.openai.com/v1 or http://localhost:11434/v1 */
  baseUrl: string;
  model: string;
  /** Some servers reject reasoning_effort; set false to omit. */
  supportsReasoningEffort?: boolean;
}

export class OpenAiCompatProvider implements Provider {
  readonly name = "openai-compat";
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private supportsReasoningEffort: boolean;

  constructor(opts: OpenAiOptions) {
    this.model = opts.model;
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? "none";
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.supportsReasoningEffort = opts.supportsReasoningEffort ?? false;
  }

  async stream(
    req: ProviderRequest,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<AssistantTurn> {
    const body: Record<string, unknown> = {
      model: this.model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: req.maxTokens,
      messages: renderMessages(req.system, req.messages),
    };
    if (req.tools.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }
    if (req.temperature != null) body.temperature = req.temperature;
    if (req.effort && this.supportsReasoningEffort) {
      // OpenAI reasoning models accept low|medium|high; clamp the wider scale.
      body.reasoning_effort =
        req.effort === "xhigh" || req.effort === "max" ? "high" : req.effort;
    }

    const res = await fetchWithRetry(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });

    return this.consumeStream(res, handlers);
  }

  private async consumeStream(
    res: Response,
    handlers: StreamHandlers,
  ): Promise<AssistantTurn> {
    if (!res.body) throw new Error("no response body");

    let text = "";
    let reasoning = "";
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | null = null;
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

    for await (const ev of parseSse(res.body)) {
      if (ev.data === "[DONE]") break;
      const chunk = JSON.parse(ev.data) as Record<string, any>;
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
        usage.outputTokens = chunk.usage.completion_tokens ?? 0;
        usage.cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content.length) {
        text += delta.content;
        handlers.onText?.(delta.content);
      }
      const r = delta.reasoning_content ?? delta.reasoning;
      if (typeof r === "string" && r.length) {
        reasoning += r;
        handlers.onThinking?.(r);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          let st = toolCalls.get(idx);
          if (!st) {
            st = { id: "", name: "", args: "" };
            toolCalls.set(idx, st);
          }
          if (tc.id) st.id = tc.id;
          if (tc.function?.name) {
            st.name += tc.function.name;
            handlers.onToolCallStart?.(st.name);
          }
          if (tc.function?.arguments) st.args += tc.function.arguments;
        }
      }
    }

    const content: AssistantPart[] = [];
    if (reasoning) content.push({ type: "thinking", text: reasoning, raw: { reasoning_content: reasoning } });
    if (text) content.push({ type: "text", text });
    for (const [, tc] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
      const call: ToolCallPart = {
        type: "tool_call",
        id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        name: tc.name,
        input: {},
        rawArguments: tc.args,
      };
      try {
        call.input = tc.args ? JSON.parse(tc.args) : {};
      } catch {
        call.input = {};
      }
      content.push(call);
    }

    const stopReason: StopReason =
      toolCalls.size > 0 || finishReason === "tool_calls"
        ? "tool_use"
        : finishReason === "length"
          ? "max_tokens"
          : finishReason === "content_filter"
            ? "refusal"
            : "end_turn";

    return { message: { role: "assistant", content }, stopReason, usage };
  }
}

/** Render internal messages into OpenAI chat-completions wire format. */
function renderMessages(
  system: string,
  messages: AgentMessage[],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (system) out.push({ role: "system", content: system });

  for (const m of messages) {
    if (m.role === "system_note") {
      // Tagged user text: mid-conversation `system` role support varies wildly
      // across compatible servers, so the portable channel is a user turn.
      out.push({ role: "user", content: `<system-note>\n${m.content}\n</system-note>` });
    } else if (m.role === "user") {
      // tool_result parts become role:"tool" messages; the rest become a user message.
      const userContent: Array<Record<string, unknown>> = [];
      for (const p of m.content) {
        if (p.type === "tool_result") {
          out.push({
            role: "tool",
            tool_call_id: p.toolCallId,
            content: p.isError ? `ERROR: ${p.content}` : p.content,
          });
        } else if (p.type === "text") {
          userContent.push({ type: "text", text: p.text });
        } else {
          userContent.push({
            type: "image_url",
            image_url: { url: `data:${p.mediaType};base64,${p.data}` },
          });
        }
      }
      if (userContent.length) {
        // Plain string when text-only (older servers choke on array content).
        const onlyText = userContent.every((c) => c.type === "text");
        out.push({
          role: "user",
          content: onlyText
            ? userContent.map((c) => c.text).join("")
            : userContent,
        });
      }
    } else {
      const msg: Record<string, unknown> = { role: "assistant" };
      let text = "";
      let reasoning = "";
      const calls: Array<Record<string, unknown>> = [];
      for (const p of m.content) {
        if (p.type === "text") text += p.text;
        else if (p.type === "thinking") reasoning += p.text;
        else {
          calls.push({
            type: "function",
            id: p.id,
            function: { name: p.name, arguments: p.rawArguments ?? JSON.stringify(p.input) },
          });
        }
      }
      msg.content = text || null;
      // Echo reasoning back for servers that expect it (DeepSeek-style);
      // servers that don't know the field ignore it.
      if (reasoning) msg.reasoning_content = reasoning;
      if (calls.length) msg.tool_calls = calls;
      out.push(msg);
    }
  }
  return out;
}
