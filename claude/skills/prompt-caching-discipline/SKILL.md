---
name: prompt-caching-discipline
description: Apply prompt caching discipline when editing Claude API / Anthropic SDK code. Trigger when touching @anthropic-ai/sdk imports, fetch calls to api.anthropic.com/v1/messages, or building system prompts that will be reused across turns. Source — "Prompt Caching in LLMs, Clearly Explained" (Avi Chawla, 2026-04-16).
---

# Prompt Caching Discipline

Prompt caching is **architectural discipline**, not a feature toggle. Claude Code achieves 92% cache hit rate / 81% cost reduction by following these rules religiously. Apply the same rules whenever you build with `@anthropic-ai/sdk` or call the Messages API directly.

## When this skill triggers

- Editing any file that imports `@anthropic-ai/sdk` or `Anthropic`
- Editing any `fetch()` to `api.anthropic.com/v1/messages`
- Building a system prompt or tool definitions intended for reuse
- Diagnosing high token cost or cache misses on any AI service
- Reviewing PRs that touch AI loops

## The architecture

Every API request has two parts:

1. **Static prefix** (cached) — system instructions → tool definitions → retrieved context. Identical across turns.
2. **Dynamic suffix** (uncharged at cache-read rate) — user messages, tool outputs, conversation history. Grows over time.

The infrastructure hashes the full token sequence from byte zero. If anything in the prefix changes — even one character — the entire prefix recomputes at full price.

## Prefix order (TOP → BOTTOM)

```
┌─────────────────────────────────────┐
│ 1. System instructions              │  STATIC
│ 2. Tool definitions                 │  ↓
│ 3. Retrieved context / docs         │  cached prefix
│ ─── cache_control breakpoint ───    │
│ 4. Conversation history             │  DYNAMIC
│ 5. Current user message             │  ↓
│ 6. Tool outputs                     │  charged at full price
└─────────────────────────────────────┘
```

Add `cache_control: {type: "ephemeral"}` at the boundary. With auto-caching enabled on the Anthropic API, the breakpoint advances automatically as the conversation grows.

## Three fragility rules (NEVER violate)

1. **Never modify tools mid-session.** Tool defs are part of the cached prefix; adding/removing/reordering wipes everything downstream.
2. **Never switch models mid-session.** Caches are model-specific (Opus↔Sonnet have different KV weights). Switching = full rebuild.
3. **Never mutate anything upstream of the cache breakpoint.** Need to inject state? Append to the next user message, never edit the system prompt.

## Cache killers — specific patterns to forbid

| Pattern | Why it kills cache | Fix |
|---------|--------------------|-----|
| `Date: ${today}` in system prompt | Hash changes every UTC midnight → 0% hit rate after day 1 | Inject date in user message wrapper |
| Per-request IDs / timestamps in prefix | Hash changes every call → 0% hit rate ever | Move to dynamic suffix |
| Non-deterministic JSON serialization | Sort order varies → hash varies | Pin sort order or pre-serialize |
| Adding tool mid-conversation | Tool defs are part of prefix → invalidates all downstream | Load all tools upfront |
| Switching from Opus to Sonnet to save cost | Different model = different cache | Keep one model per session |
| Editing system prompt to add reminder | Mutates prefix → full rebuild | Append reminder to next user message |

## Cache-safe forking (for compaction)

When approaching context limits, don't rebuild — fork:

1. Keep the system prompt, tools, and conversation history untouched.
2. Append the compaction instruction as a NEW user message.
3. Cached prefix gets reused; only the compaction instruction is billed at full price.
4. Store the compacted summary, then start a new session seeded with that summary.

## Monitoring (mandatory)

Every API response includes three usage fields. Log them to `~/Ship/logs/cache-metrics/{service}.jsonl` per the schema in `cloud-bot/metrics.ts`:

```typescript
{
  ts: string,
  service: string,
  path?: string,           // e.g., 'warm', 'cold', 'intent-classifier'
  chatId?: string,
  requestId?: string,
  model: string,
  input_tokens: number,
  cache_read_input_tokens: number,
  cache_creation_input_tokens: number,
  output_tokens: number,
  duration_ms: number,
}
```

**Cache efficiency** = `cache_read / (cache_read + cache_creation)`. Target ≥ 80% on any service that serves repeat turns. Below threshold = something is mutating the prefix — find and fix it.

## Code patterns

### Adding cache_control to a system prompt (single block)

```typescript
// BEFORE — no caching
body: JSON.stringify({
  model: MODEL,
  max_tokens: 1024,
  system: SYSTEM_PROMPT,
  messages: [{ role: 'user', content: text }],
})

// AFTER — system prompt cached
body: JSON.stringify({
  model: MODEL,
  max_tokens: 1024,
  system: [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
  ],
  messages: [{ role: 'user', content: text }],
})
```

### Splitting a mixed prompt into static + dynamic

```typescript
// BEFORE — mixed instructions and message in one user content
const prompt = `Extract signals from: "${userText}"
Schema: { entities: [], people: [], ... }`
messages: [{ role: 'user', content: prompt }]

// AFTER — static schema in system (cacheable), only message in user content
system: [{ type: 'text', text: SCHEMA_AND_RULES, cache_control: { type: 'ephemeral' } }]
messages: [{ role: 'user', content: `Message: "${userText}"` }]
```

### Cache-safe fork pattern (compaction)

```typescript
// DON'T: rebuild from scratch
const compacted = await summarize(history)
const newSession = startFresh({ system, tools, history: compacted })

// DO: append compaction instruction, preserve cache
const messages = [...history, { role: 'user', content: 'Summarize the above into a brief.' }]
const summary = await client.messages.create({ system, tools, messages })
// Then start new session seeded with `summary` only.
```

## Verification checklist (before shipping any AI loop edit)

- [ ] Prefix order: system → tools → retrieved context → user/history
- [ ] No timestamps, request IDs, or per-call values in the prefix
- [ ] Tool definitions deterministic (no dynamic load mid-session)
- [ ] One model per session (no Opus↔Sonnet switching)
- [ ] `cache_control: {type: "ephemeral"}` placed at the prefix/suffix boundary
- [ ] Metrics logged to `~/Ship/logs/cache-metrics/{service}.jsonl`
- [ ] After 24h of traffic, hit rate ≥ 80% in production

## Reference

- Source article: https://x.com/_avichawla/status/2044670188998803855
- Reference implementation: Claude Code itself (92% hit rate at scale)
- Existing memory: `feedback_api_cache_discipline.md` (the rules)
- Existing memory: `feedback_cache_optimization.md` (Claude Code session hygiene — distinct from API rules)
- Cloud bot metrics helper: `/Users/user/Ship/cloud-bot/metrics.ts`
