# blurb harness

A minimal, high-performance agentic coding harness. Works with the Anthropic
Messages API and any OpenAI-compatible endpoint (vLLM, Ollama, llama.cpp,
OpenRouter, Together, Groq, Fireworks, OpenAI). Zero runtime dependencies —
Node 22 built-ins only.

See [DESIGN.md](./DESIGN.md) for the research survey (how Claude Code, Codex
CLI, Amp, OpenCode, Aider, SWE-agent et al. work), the principles this
harness is built on, and the roadmap.

## What it does

- **Single flat agent loop** — stream a turn, run tool calls (read-only
  calls in parallel), append results, repeat.
- **Six tools**: `bash`, `read`, `write`, `edit` (exact string replace with
  read-before-write + staleness checks), `grep`, `glob`. All outputs are
  token-budgeted with explicit truncation markers.
- **Cache-disciplined prompting** — byte-stable system prompt, incremental
  cache breakpoints (Anthropic), append-only message structure.
- **Context management** — restorable pruning of stale tool results first
  (cheap), model-written structured compaction only as a last resort.
- **Evidence-grounded completion** — a deterministic harness gate that
  refuses "done" when files were modified but nothing was run afterwards.
- **Lossless provider round-trips** — thinking blocks/signatures
  (Anthropic) and `reasoning_content` (DeepSeek/Qwen-style) survive tool
  loops intact.
- Reads `AGENTS.md` / `CLAUDE.md` project instructions.

## Usage

```bash
cd harness
npm install
npm run build

# Anthropic (default; needs ANTHROPIC_API_KEY)
node dist/cli.js "fix the failing test in app/"

# Any OpenAI-compatible server
node dist/cli.js --provider openai-compat \
  --base-url http://localhost:11434/v1 --model qwen3:32b \
  "add input validation to build-grid.mjs"

# OpenAI itself (enables reasoning_effort mapping)
node dist/cli.js --provider openai --base-url https://api.openai.com/v1 \
  --model gpt-5.2 --effort high "..."

# Interactive REPL
node dist/cli.js
```

Env vars: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, `BLURB_PROVIDER`,
`BLURB_MODEL`, `BLURB_BASE_URL`.

## Tests

```bash
npm test   # 13 tests: tools, SSE parsing, loop threading, pruning, verification gate
```

Tests run the full agent loop against a scripted `MockProvider` — no network,
fully deterministic.

## Library use

```ts
import { Agent } from "./dist/agent.js";
import { builtinTools } from "./dist/tools/index.js";
import { buildSystemPrompt } from "./dist/prompt.js";
import { AnthropicProvider } from "./dist/providers/anthropic.js";

const agent = new Agent({
  provider: new AnthropicProvider({ model: "claude-opus-5" }),
  tools: builtinTools,
  system: await buildSystemPrompt(process.cwd()),
  cwd: process.cwd(),
  effort: "xhigh",
  onEvent: (ev) => { /* render */ },
});
const result = await agent.run("your task");
```
