# Blurb Harness — Design

An agentic coding harness that works with the Anthropic Messages API and any
OpenAI-compatible API (vLLM, Ollama, llama.cpp, OpenRouter, Together, Groq,
Fireworks, OpenAI itself). This document covers three things: how the leading
harnesses are built, what the evidence says actually drives performance, and
the design of this harness — including where we deliberately improve on the
state of the art.

---

## 1. Why the harness matters

The harness — the deterministic code around the model — is worth
model-generations of performance:

- LangChain measured a **13.7-point Terminal-Bench 2.0 gain from harness
  changes alone**, model fixed.
- The "How good is your harness?" study (OpenReview) found harness choice
  produces gains comparable to best-model choice.
- Meta-Harness (arXiv 2603.28052) auto-discovered a harness that beat the
  hand-engineered Terminus harness on Terminal-Bench 2 (76.4% vs 74.7%,
  same model).
- Reverse-engineering of Claude Code found it is "1.6% AI decision logic,
  98.4% deterministic infrastructure" (~512K LOC of TypeScript around one
  model call).

At the same time, the *kind* of harness work that pays off has shifted. In
2024, SWE-agent showed interface design was worth >10 points (removing its
edit-linter guardrail collapsed scores 15.0% → 3.0%). By 2025–26,
mini-swe-agent — ~100 lines of Python, bash as the only tool, no native tool
calling — scored 65–74% on SWE-bench Verified, within a few points of
elaborate scaffolds. **The load-bearing scaffolding moved out of planning
machinery and into four places:** edit-format reliability, feedback loops
(tests/linters/LSP), context hygiene, and provider-fidelity plumbing. That is
where this harness invests.

## 2. The landscape

| Harness | Loop | Edit mechanism | Search | Context strategy | Sandbox |
|---|---|---|---|---|---|
| **Claude Code** | Single flat loop, depth-1 subagents (Task tool) | Exact string search/replace | ripgrep/glob, explicitly no RAG | 5-stage: tool-result caps (25K tok) → microcompact (clear old tool results, cache-aware) → LLM auto-compact at ~92% with 9-section summary + re-read of last 5 files | Seatbelt / bubblewrap + permission modes |
| **Codex CLI** (Rust) | Single loop, submit/event architecture | `apply_patch` V4A diff grammar — model **RL-trained on the exact format** | shell | Server-side `/responses/compact` returning an encrypted summary blob; re-reads 5 recent files after | Seatbelt / Landlock+seccomp, network off by default |
| **Amp** | Single worker loop + **oracle** (stronger model consulted for planning/review) | String replace + undo | grep + Librarian subagent (remote repos) | Threads, handoff compaction; unconstrained budgets | approvals |
| **OpenCode** | Client/server; Vercel AI SDK streamText loop | String replace with fallback matchers | grep/glob | Prune tool outputs first (only if it frees >20K tok; last 40K protected), then summarize at ~90% | per-agent permissions; plan/build modes |
| **Cline** | One tool call per message, human approval | SEARCH/REPLACE blocks, whole-file fallback | regex + tree-sitter defs | Sliding window + read dedup; git checkpoints instead of sandbox | approval + checkpoints |
| **Aider** | Pre-agentic pair-programming; architect/editor split | The edit-format laboratory: whole / diff / udiff (GPT-4T 20%→61% on lazy-coding) | tree-sitter repo map (PageRank over defs) | repo map under token budget | git as undo |
| **SWE-agent / mini** | ACI-designed loop / bash-only 100-line loop | linter-guarded edit / none | windowed viewer / none | linear history; observation masking | subprocess |
| **OpenHands** | Event-sourced append-only log; agent = f(history) | CodeAct (code as action) | — | pluggable Condensers (LLM summarizer ≈ 2× cost cut) | Docker (now optional) |
| **Gemini CLI** | Single ReAct loop + loop-detection | old/new string replace w/ self-correction | ripgrep | compress at 70%, keep last 30%, XML state snapshot | Seatbelt/Docker |
| **Cursor** | IDE loop, multi-model | sketch + apply-model (second model applies edits) | **custom embedding index** (the RAG holdout; ~12.5% claimed gain) | — | cloud VMs |

Convergent evolution across all of them:

1. **Single flat loop.** Nobody serious ships planner/executor graph
   architectures; Claude Code is "one loop, maximum one branch". Subagents
   exist for *context isolation* (fan-out reads, verification with fresh
   context), not parallel writing (Cognition's "Don't Build Multi-Agents").
2. **String-replace or trained-diff edits.** Exact string search/replace won
   because it fails loudly and is verifiable; custom diff grammars (V4A,
   udiff) win only when the model is RL-trained on them.
3. **Agentic grep beat RAG** (everywhere except Cursor). Anthropic removed
   vector search from Claude Code in May 2025 — precision, freshness, no
   index infra, privacy. Windsurf, Cline, Devin, and Amp all dropped vector
   indexes too.
4. **The same context stack**: instruction files (AGENTS.md/CLAUDE.md),
   tool-output caps with truncation markers, cheap pruning of stale tool
   results, threshold-triggered LLM summarization as last resort, todo/plan
   recitation as an attention anchor, subagents returning 1–2K-token
   summaries.
5. **Feedback loops are the cheapest points on the table**: OpenCode pipes
   LSP diagnostics into the transcript after every edit; SWE-agent's edit
   linter; Anthropic's best-of-N reranking discards patches that break
   visible regression tests (Sonnet 4: 72.7% → 80.2%).

## 3. What the evidence says drives performance

Distilled from published ablations and engineering postmortems:

- **Cache is the #1 cost lever.** Manus calls KV-cache hit rate "the single
  most important metric for a production agent": agent workloads are ~100:1
  input:output tokens, and cached-vs-uncached input is a 10× price difference
  on Anthropic (0.1× reads). Everything in a harness must respect the prefix:
  append-only message structure, byte-stable system prompt (no timestamps),
  deterministic serialization, never swap the tool set mid-session.
- **Cheap pruning beats LLM summarization until you truly hit the window.**
  JetBrains (arXiv 2508.21433): simple observation masking (keep last 10 tool
  outputs, stub the rest) **halves cost and matches or beats LLM
  summarization** on SWE-bench Verified; summarization also made agents run
  13–15% *longer* (summaries hide state, causing re-exploration).
  Observation tokens are ~84% of trajectory content and are mostly read once.
- **Context rot is real.** Chroma's 18-model study: accuracy degrades
  non-uniformly with input length even on trivial tasks — cliffs as early as
  ~50K tokens in a 200K window. Budget context like a scarce resource even
  when the window is huge.
- **Tool minimalism.** MCP tool overload measurably hurts (−9.5% average
  across 6 LLMs; sharp degradation past ~20 tools). Small orthogonal
  toolsets, prescriptive "when to call" descriptions, aggressive output caps
  (Anthropic caps tool responses at 25K tokens).
- **Interleaved thinking consolidates action**: enabling reasoning between
  tool calls reduced turns 16.9 → 12.5 and tool calls 79.5 → 72.9 while
  improving success; higher effort up front often lowers *total* cost by
  cutting turn count.
- **Verification wins, but its form is model-dependent.** Execution feedback
  + regression-test filtering + best-of-N reranking are the biggest scoring
  levers on SWE-bench. But on the newest models, *prompted* "double-check
  your work" scaffolding causes over-verification — the check belongs in the
  harness as a deterministic gate, not in the prompt.

## 4. Our architecture

```
harness/
  src/
    types.ts            internal message/tool/provider model
    agent.ts            the loop: stream → tools → context mgmt → repeat
    context.ts          estimate / prune / compact
    prompt.ts           byte-stable system prompt + AGENTS.md/CLAUDE.md
    sse.ts, http.ts     SSE parser, retrying fetch (429/529/5xx, retry-after)
    providers/
      anthropic.ts      Messages API adapter (cache breakpoints, thinking)
      openai.ts         chat-completions adapter (compat-server quirks)
      mock.ts           scripted provider for tests
    tools/              bash, read, write, edit, grep, glob (+ fs walker)
  DESIGN.md, README.md
```

Zero runtime dependencies (Node 22 built-ins only). Deliberate decisions:

**One flat loop.** `Agent.run()` is: call provider → if tool calls, execute →
append results → manage context → repeat. Consecutive read-only tool calls
execute in parallel; a mutating call is a barrier. No planner, no graph.

**Internal model is Anthropic-shaped.** The richer wire format is the
superset: ordered typed content blocks per turn (`text | thinking |
tool_call | tool_result | image`), preserving interleaving order, multi-part
results, and `is_error`. The OpenAI adapter projects onto
`content`/`tool_calls`/`role:"tool"`; the reverse projection would be lossy,
which is exactly the LiteLLM failure mode (canonicalizing on chat-completions
makes Anthropic thinking+tool-use a perennial bug farm — dropped thinking
blocks, signature 400s). Lesson adopted from pi-ai: **abstract the ~4 wire
protocols, not the N providers.**

**Lossless reasoning round-trip.** `ThinkingPart` carries `text`, an
Anthropic `signature`, and an opaque `raw` payload. Same-provider replay
reproduces the original bytes (signatures intact — required for Anthropic
tool loops); OpenAI-compatible replay echoes `reasoning_content` for servers
that want it. Cross-provider handoff degrades explicitly, never silently.

**Tool design.** Six tools: `bash` for breadth, `read/write/edit` because
they enforce invariants bash can't (read-before-write, mtime staleness
checks, unique-match string replacement that fails loudly),
`grep/glob` because they're parallel-safe and schedulable. Every output is
token-budgeted (~40K chars) with middle-out truncation and an explicit
marker telling the model how to narrow the request — never silent.

**Cache discipline.** System prompt is assembled once per session and never
mutated (no timestamps; environment info is static). One cache breakpoint on
the system block (caches tools+system), one on the last message block so
each turn extends the cached prefix incrementally. Harness-side steering
mid-session goes through `system_note` messages appended *after* the cached
prefix — never by editing the system prompt.

**Context management: prune, then compact.**
1. Past 50% of budget: **batched pruning** — tool results older than the
   last 3 assistant turns and larger than 2K chars are replaced in place with
   a restorable stub (`[stale read result pruned (N chars). Re-run the tool
   if you need it again.]`). The filesystem is the real memory; re-running a
   read is cheap. Pruning is batched at a threshold rather than done
   per-turn precisely to amortize the cache invalidation it causes.
2. Past 80%: **compaction** — the model writes a structured handoff summary
   (goal / verified state / key knowledge / next steps / pitfalls — the same
   section discipline as Claude Code's 9-section compact), and the
   transcript restarts as summary + continuation instruction.

**Evidence-grounded completion (novel).** The harness tracks a boolean:
did any `write`/`edit` succeed since the last `bash` run? If the model
returns `end_turn` while that flag is set, the harness injects a one-time
system note — "you modified files but ran nothing since; verify or say why
not" — and continues the loop. This moves the "always verify your work"
instruction out of the prompt (where it causes over-verification on strong
models and gets ignored by weak ones) into a **deterministic, zero-cost
harness gate** that fires only when verification is actually missing. This
is the pattern we believe in generally: *claims should be checked against
the event log by code, not by more prompting.*

**Provider-quirk hardening.** The chat-completions stream accumulator is
defensive by design: tool-call deltas keyed by index with id-fallback,
tolerance for `reasoning` vs `reasoning_content`, argument strings that
arrive as objects, servers that omit usage, `[DONE]` handling, and synthetic
call IDs for servers that omit them. `finish_reason` quirks (`stop` despite
tool calls present) are handled by treating accumulated tool calls as
authoritative.

## 5. Where we improve on the state of the art

Implemented:

1. **Evidence-grounded completion** (above) — deterministic verification
   gate instead of prompt scaffolding. To our knowledge no shipping harness
   does this as a harness-level check.
2. **Restorable pruning stubs + batched cache-conscious scheduling** —
   combines the JetBrains observation-masking result with Manus's
   "compress restorably" rule (keep the pointer, drop the payload) and
   schedules edits in batches to amortize prefix invalidation.
3. **Protocol-level provider abstraction with explicit degradation** — the
   superset internal model + opaque raw payloads; cross-provider handoff is
   a deliberate transform, not an accident.
4. **Read-only parallelism as a tool attribute** — tools declare
   `readOnly`; the scheduler batches adjacent read-only calls. Dedicated
   tools exist precisely to give the harness schedulable semantics bash
   can't express.

Roadmap (designed, not yet built):

5. **Turn-level replay journal.** Append-only JSONL of `AgentEvent`s
   (OpenHands-style event sourcing) → deterministic resume, post-hoc
   debugging, and cheap A/B harness experiments (replay the same trajectory
   prefix against two harness variants).
6. **Capability probing for compat servers.** One cheap probe request on
   first contact with an unknown `--base-url`: does it stream tool-call
   deltas? which reasoning field? does it honor `tool_choice`? Persist a
   capability profile and adapt (e.g., fall back to non-streaming tool
   calls) instead of failing at minute 20 of a session.
7. **Effort routing.** Map loop phases to effort: exploration turns at
   `low`/`medium`, implementation and debugging at `high`/`xhigh`. The
   research shows higher effort cuts turn count on hard steps while low
   effort is fine for mechanical ones; today's harnesses use one static
   setting per session.
8. **LSP/diagnostic feedback** (OpenCode's best idea): after each edit, run
   a fast project-configured check (`tsc --noEmit -p . --incremental`,
   `ruff`) and append diagnostics to the tool result. Compiler errors are
   the cheapest ground truth available.
9. **Verifier subagent with fresh context.** For "am I done?" checks on
   long tasks, spawn a clean-context instance that reads the diff and the
   task statement and tries to refute completion — fresh-context
   verification outperforms self-critique, and refutation framing avoids
   sycophancy.
10. **Best-of-N with regression-test filtering** for headless/batch mode:
    sample N candidate patches, discard those failing model-selected
    regression tests, rank the rest — the single biggest published scoring
    lever (+7.5 points on SWE-bench for Sonnet 4).

## 6. Evaluation plan

- **Unit layer** (exists): tools, SSE parser, loop threading, pruning, and
  the verification gate run against the scripted `MockProvider` — the same
  mechanism enables deterministic harness A/B tests later.
- **Smoke layer**: run against a local OpenAI-compatible server (Ollama/vLLM)
  and against the Anthropic API on a fixed small task set (fix failing test,
  add endpoint, refactor) in a scratch repo; assert on final repo state, not
  transcripts.
- **Benchmark layer** (when it matters): Terminal-Bench and SWE-bench
  Verified subsets. Track *cost and turns* alongside solve rate — cache hit
  ratio and tokens-per-solve are first-class metrics, per §3.

## 7. Sources

Key references (full URL list in the research notes):
Anthropic engineering — "Writing effective tools for agents", "Effective
context engineering for AI agents", "Building the multi-agent research
system", SWE-bench scaffold post; MinusX "Decoding Claude Code"; VILA-Lab
"Dive into Claude Code"; Thorsten Ball "How to Build an Agent"; Codex CLI
repo + prompting guide (V4A apply_patch); Aider edit-format docs and
architect/editor results; SWE-agent ACI paper (arXiv 2405.15793);
mini-swe-agent; OpenHands SDK paper (arXiv 2511.03690); JetBrains "The
Complexity Trap" (arXiv 2508.21433); Chroma "Context Rot"; Manus "Context
Engineering for AI Agents"; Cognition "Don't Build Multi-Agents"; OpenRouter
reasoning/caching normalization docs; vLLM reasoning-outputs and
tool-calling docs; pi-ai / pi-mono; Vercel AI SDK provider spec; LiteLLM
issue tracker (negative lessons); Terminal-Bench (tbench.ai).
