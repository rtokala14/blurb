/**
 * Core types for the harness.
 *
 * The internal message representation is a content-block model (closest to the
 * Anthropic Messages API shape, which is the richer of the two wire formats we
 * target). Each provider adapter maps to/from this shape losslessly: anything
 * provider-specific that must survive a round trip (thinking signatures,
 * reasoning_content, raw tool-call argument strings) is carried on the block in
 * dedicated fields the other layers treat as opaque.
 */

// ---------------------------------------------------------------------------
// Content blocks

export interface TextPart {
  type: "text";
  text: string;
}

/**
 * Model reasoning. `signature` is Anthropic's opaque integrity token; `raw`
 * carries whatever an OpenAI-compatible server returned (reasoning_content,
 * encrypted reasoning items, ...) so the adapter can echo it back verbatim.
 */
export interface ThinkingPart {
  type: "thinking";
  text: string;
  signature?: string;
  raw?: unknown;
}

export interface ToolCallPart {
  type: "tool_call";
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Original argument string as streamed, in case JSON.parse "fixed" anything. */
  rawArguments?: string;
}

export interface ToolResultPart {
  type: "tool_result";
  toolCallId: string;
  /** Name of the tool that produced this (needed by the OpenAI adapter). */
  toolName: string;
  content: string;
  isError?: boolean;
}

export interface ImagePart {
  type: "image";
  mediaType: string;
  /** base64-encoded */
  data: string;
}

export type UserPart = TextPart | ImagePart | ToolResultPart;
export type AssistantPart = TextPart | ThinkingPart | ToolCallPart;

// ---------------------------------------------------------------------------
// Messages

export interface UserMessage {
  role: "user";
  content: UserPart[];
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantPart[];
}

/**
 * Steering/context injected by the harness mid-conversation (not user text and
 * not part of the top-level system prompt, which must stay byte-stable for
 * prompt caching). Adapters render this as the provider best supports it.
 */
export interface SystemNote {
  role: "system_note";
  content: string;
}

export type AgentMessage = UserMessage | AssistantMessage | SystemNote;

// ---------------------------------------------------------------------------
// Tools

export interface JsonSchema {
  type?: string;
  [key: string]: unknown;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ToolOutput {
  content: string;
  isError?: boolean;
}

export interface ToolContext {
  /** Project root the agent operates in. */
  cwd: string;
  signal: AbortSignal;
  /** Files read so far this session (path -> mtimeMs at read). For edit staleness checks. */
  readFiles: Map<string, number>;
  log: (line: string) => void;
}

export interface Tool {
  def: ToolDef;
  /** Read-only tools may be executed in parallel with each other. */
  readOnly: boolean;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput>;
}

// ---------------------------------------------------------------------------
// Provider abstraction

export type StopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "refusal"
  | "error";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ProviderRequest {
  model: string;
  /** Stable system prompt. Keep byte-identical across turns for caching. */
  system: string;
  messages: AgentMessage[];
  tools: ToolDef[];
  maxTokens: number;
  /** Reasoning effort knob, mapped per provider (effort / reasoning_effort). */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  temperature?: number;
}

export interface StreamHandlers {
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolCallStart?: (name: string) => void;
}

export interface AssistantTurn {
  message: AssistantMessage;
  stopReason: StopReason;
  usage: Usage;
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  stream(
    req: ProviderRequest,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<AssistantTurn>;
}

// ---------------------------------------------------------------------------
// Events emitted by the agent loop (for UIs / logging / tests)

export type AgentEvent =
  | { type: "turn_start"; turn: number }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; name: string; input: Record<string, unknown> }
  | { type: "tool_end"; name: string; output: ToolOutput; durationMs: number }
  | { type: "compaction"; beforeTokens: number }
  | { type: "turn_end"; stopReason: StopReason; usage: Usage }
  | { type: "done"; reason: string };
