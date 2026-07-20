import "server-only"

import { FoundryError } from "./client"
import { getFoundryConfig } from "./config"
import { getFoundryToken } from "./token"

/**
 * Client for Foundry's vendor-native LLM proxy.
 *
 * Foundry exposes provider-compatible endpoints under
 *   {host}/api/v2/llm/proxy/{provider}/v1/...
 * authenticated with the same Foundry bearer token used everywhere else. This
 * lets us call OpenAI- and Anthropic-shaped APIs directly (no AIP session /
 * ontology query round-trip) for lightweight text tasks like email refining.
 *
 *   OpenAI:    POST {base}/openai/v1/chat/completions
 *   Anthropic: POST {base}/anthropic/v1/messages
 */

export type LlmProvider = "openai" | "anthropic"

export interface ChatMessage {
    role: "system" | "user" | "assistant"
    content: string
}

export interface CompleteOptions {
    messages: ChatMessage[]
    /** overrides the configured default provider */
    provider?: LlmProvider
    /** overrides the configured default model */
    model?: string
    maxTokens?: number
    temperature?: number
    signal?: AbortSignal
}

function proxyUrl(provider: LlmProvider, path: string): string {
    const cfg = getFoundryConfig()
    return `${cfg.hostname}/api/v2/llm/proxy/${provider}/v1${path}`
}

async function proxyFetch(
    provider: LlmProvider,
    path: string,
    body: unknown,
    signal?: AbortSignal
): Promise<Response> {
    const token = await getFoundryToken()
    const res = await fetch(proxyUrl(provider, path), {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            // Anthropic's API requires a version header; the proxy forwards it.
            ...(provider === "anthropic"
                ? { "anthropic-version": "2023-06-01" }
                : {}),
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal,
    })
    if (!res.ok) {
        const detail = await res.text().catch(() => "")
        throw new FoundryError(
            `LLM proxy ${provider} POST ${path} failed (${res.status})`,
            res.status,
            detail.slice(0, 2000)
        )
    }
    return res
}

/* ------------------------------------------------------------------ */
/* Response shapes (only the fields we read)                           */
/* ------------------------------------------------------------------ */

interface OpenAiChatResponse {
    choices?: { message?: { content?: string } }[]
}

interface AnthropicMessageResponse {
    content?: { type: string; text?: string }[]
}

/**
 * Run a single chat completion through the proxy and return the assistant
 * text. Provider/model default to the configured `llmProxy` settings.
 */
export async function complete(options: CompleteOptions): Promise<string> {
    const cfg = getFoundryConfig()
    const provider = options.provider ?? cfg.llmProxy.provider
    const model = options.model ?? cfg.llmProxy.model
    const maxTokens = options.maxTokens ?? cfg.llmProxy.maxTokens

    if (provider === "anthropic") {
        // Anthropic keeps the system prompt out of the messages array.
        const system = options.messages
            .flatMap((m) => (m.role === "system" ? [m.content] : []))
            .join("\n\n")
        const messages = options.messages
            .flatMap((m) =>
                m.role !== "system" ? [{ role: m.role, content: m.content }] : []
            )
        const res = await proxyFetch(
            "anthropic",
            "/messages",
            {
                model,
                max_tokens: maxTokens,
                ...(system ? { system } : {}),
                ...(options.temperature !== undefined
                    ? { temperature: options.temperature }
                    : {}),
                messages,
            },
            options.signal
        )
        const data = (await res.json()) as AnthropicMessageResponse
        return (data.content ?? [])
            .flatMap((b) =>
                b.type === "text" && typeof b.text === "string"
                    ? [b.text as string]
                    : []
            )
            .join("")
            .trim()
    }

    const res = await proxyFetch(
        "openai",
        "/chat/completions",
        {
            model,
            max_tokens: maxTokens,
            ...(options.temperature !== undefined
                ? { temperature: options.temperature }
                : {}),
            messages: options.messages,
        },
        options.signal
    )
    const data = (await res.json()) as OpenAiChatResponse
    return (data.choices?.[0]?.message?.content ?? "").trim()
}
