/**
 * Anthropic Messages API adapter (streaming).
 *
 * Cache strategy: one cache_control breakpoint on the last system block
 * (caches tools + system) and one on the last message content block, so each
 * turn extends the cached prefix incrementally. The request body is built
 * deterministically (stable key order, no timestamps) — see DESIGN.md.
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
  ThinkingPart,
  ToolCallPart,
} from "../types.js";

export interface AnthropicOptions {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  /** Extra beta headers, e.g. context management. */
  betas?: string[];
}

interface AnthropicContentBlockParam {
  type: string;
  [key: string]: unknown;
}

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private betas: string[];

  constructor(opts: AnthropicOptions) {
    this.model = opts.model;
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.baseUrl = (opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.betas = opts.betas ?? [];
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  }

  async stream(
    req: ProviderRequest,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<AssistantTurn> {
    const body = this.buildBody(req);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
    if (this.betas.length) headers["anthropic-beta"] = this.betas.join(",");

    const res = await fetchWithRetry(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: signal ?? null,
    });

    return this.consumeStream(res, handlers);
  }

  private buildBody(req: ProviderRequest): Record<string, unknown> {
    const tools = req.tools.map((t, i) => {
      const def: Record<string, unknown> = {
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      };
      return def;
    });

    const messages = renderMessages(req.messages);
    // Incremental caching: breakpoint on the last content block of the last message.
    const last = messages[messages.length - 1];
    if (last && Array.isArray(last.content) && last.content.length > 0) {
      const lastBlock = last.content[last.content.length - 1] as AnthropicContentBlockParam;
      if (lastBlock.type === "text" || lastBlock.type === "tool_result") {
        lastBlock.cache_control = { type: "ephemeral" };
      }
    }

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens,
      system: [
        {
          type: "text",
          text: req.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    };
    if (tools.length) body.tools = tools;
    if (req.effort) body.output_config = { effort: req.effort };
    // Adaptive thinking is the default on current models when supported; we
    // only send `thinking` explicitly if the caller wants summaries surfaced.
    return body;
  }

  private async consumeStream(
    res: Response,
    handlers: StreamHandlers,
  ): Promise<AssistantTurn> {
    if (!res.body) throw new Error("no response body");
    const content: AssistantPart[] = [];
    let stopReason: StopReason = "end_turn";
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

    // per-index accumulation state
    const partial = new Map<number, { part: AssistantPart; args?: string }>();

    for await (const ev of parseSse(res.body)) {
      if (ev.event === "ping") continue;
      const data = JSON.parse(ev.data) as Record<string, any>;
      switch (data.type) {
        case "message_start": {
          const u = data.message?.usage;
          if (u) {
            usage.inputTokens = u.input_tokens ?? 0;
            usage.cacheReadTokens = u.cache_read_input_tokens ?? 0;
            usage.cacheWriteTokens = u.cache_creation_input_tokens ?? 0;
          }
          break;
        }
        case "content_block_start": {
          const b = data.content_block;
          if (b.type === "text") {
            partial.set(data.index, { part: { type: "text", text: "" } });
          } else if (b.type === "thinking" || b.type === "redacted_thinking") {
            partial.set(data.index, {
              part: { type: "thinking", text: "", raw: b.type === "redacted_thinking" ? b : undefined },
            });
          } else if (b.type === "tool_use") {
            handlers.onToolCallStart?.(b.name);
            partial.set(data.index, {
              part: { type: "tool_call", id: b.id, name: b.name, input: {} },
              args: "",
            });
          }
          break;
        }
        case "content_block_delta": {
          const st = partial.get(data.index);
          if (!st) break;
          const d = data.delta;
          if (d.type === "text_delta" && st.part.type === "text") {
            st.part.text += d.text;
            handlers.onText?.(d.text);
          } else if (d.type === "thinking_delta" && st.part.type === "thinking") {
            st.part.text += d.thinking;
            handlers.onThinking?.(d.thinking);
          } else if (d.type === "signature_delta" && st.part.type === "thinking") {
            (st.part as ThinkingPart).signature =
              ((st.part as ThinkingPart).signature ?? "") + d.signature;
          } else if (d.type === "input_json_delta" && st.part.type === "tool_call") {
            st.args = (st.args ?? "") + d.partial_json;
          }
          break;
        }
        case "content_block_stop": {
          const st = partial.get(data.index);
          if (!st) break;
          if (st.part.type === "tool_call") {
            const call = st.part as ToolCallPart;
            call.rawArguments = st.args ?? "";
            try {
              call.input = st.args ? JSON.parse(st.args) : {};
            } catch {
              call.input = {};
            }
          }
          content.push(st.part);
          partial.delete(data.index);
          break;
        }
        case "message_delta": {
          if (data.delta?.stop_reason) {
            stopReason = mapStopReason(data.delta.stop_reason);
          }
          if (data.usage?.output_tokens != null) {
            usage.outputTokens = data.usage.output_tokens;
          }
          break;
        }
        case "error":
          throw new Error(`stream error: ${JSON.stringify(data.error)}`);
      }
    }

    return { message: { role: "assistant", content }, stopReason, usage };
  }
}

function mapStopReason(r: string): StopReason {
  switch (r) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "end_turn";
  }
}

/** Render internal messages into Anthropic wire format. */
function renderMessages(
  messages: AgentMessage[],
): Array<{ role: "user" | "assistant"; content: AnthropicContentBlockParam[] }> {
  const out: Array<{ role: "user" | "assistant"; content: AnthropicContentBlockParam[] }> = [];
  const pushUser = (blocks: AnthropicContentBlockParam[]) => {
    const prev = out[out.length - 1];
    if (prev && prev.role === "user") prev.content.push(...blocks);
    else out.push({ role: "user", content: blocks });
  };

  for (const m of messages) {
    if (m.role === "system_note") {
      // Rendered as a tagged block in a user turn: portable across models and
      // cache-safe (appended after the cached prefix, never mutating it).
      pushUser([{ type: "text", text: `<system-note>\n${m.content}\n</system-note>` }]);
    } else if (m.role === "user") {
      pushUser(
        m.content.map((p): AnthropicContentBlockParam => {
          if (p.type === "text") return { type: "text", text: p.text };
          if (p.type === "image")
            return {
              type: "image",
              source: { type: "base64", media_type: p.mediaType, data: p.data },
            };
          return {
            type: "tool_result",
            tool_use_id: p.toolCallId,
            content: p.content,
            ...(p.isError ? { is_error: true } : {}),
          };
        }),
      );
    } else {
      out.push({
        role: "assistant",
        content: m.content.map((p): AnthropicContentBlockParam => {
          if (p.type === "text") return { type: "text", text: p.text };
          if (p.type === "thinking") {
            // Redacted blocks round-trip via raw; normal blocks echo text+signature.
            if (p.raw) return p.raw as AnthropicContentBlockParam;
            return { type: "thinking", thinking: p.text, signature: p.signature ?? "" };
          }
          return { type: "tool_use", id: p.id, name: p.name, input: p.input };
        }),
      });
    }
  }
  return out;
}
