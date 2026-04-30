# Agents (Slock-style runtime)

JerryOS v2 uses the slock convention for agent definition. Each agent is a directory under `~/.claude/agents/<name>/` containing four files:

| File | Purpose |
|------|---------|
| `AGENT.md` | Frontmatter + entry-point prompt. Slock reads this first. |
| `SOUL.md` | Identity — who this agent is, voice, taste, non-negotiables. |
| `AGENTS.md` | Handoff graph — when to delegate to which other agent. |
| `MEMORY.md` | Persistent state for this agent (feedback, project notes). |

A helper script `render-prompt.sh` concatenates them into a single rendered prompt at runtime.

## The 8 example presidents

JerryOS ships 8 templates under `claude/agents/examples/`:

| Agent | Role |
|-------|------|
| `fund-president` | VC/PE fund head — deal flow, IC, LP relations |
| `infra-president` | Infra PE fund head — project deals, capacity sizing, PPA structuring |
| `ops-president` | Portfolio opco head — logistics, ops, finance |
| `ship-cto` | Engineering orchestrator — internal tools, dashboards, dataops |
| `capital-president` | Capital formation, fundraising, LP relations |
| `generalist` | Daily ops — calendar, email, inbox |
| `design-lead` | Brand & visual design |
| `legal-counsel` | Contracts, structure, compliance |

Pick which ones to scaffold via `AGENTS=` in `jerryos.conf`.

## Anatomy of AGENT.md

```markdown
---
name: fund-president
description: VC/PE fund head — orchestrates deal flow, IC prep, LP relations
model: opus
tools: [Read, Write, Edit, Bash, mcp__memory__*]
---

# Fund President

Read SOUL.md for identity and voice. Read AGENTS.md before delegating.

You orchestrate the full deal lifecycle: sourcing → screening → DD → IC → close.
Hand off to specialist skills (deal-partner, dd-lead, ic-chair, syndicate, council).
```

## Anatomy of SOUL.md

SOUL.md is identity, not instruction. It describes:

- **Voice** — How this agent talks. Terse vs prose. Direct vs hedged.
- **Taste** — What this agent considers good work. Quality bar.
- **Non-negotiables** — Things this agent will never do (e.g., "never auto-publish to LPs").
- **Allergies** — Patterns this agent flags (e.g., "consensus-bait language", "missing falsification conditions").

Rewrite SOUL.md from scratch for each agent — don't copy/paste between presidents.

## Anatomy of AGENTS.md

AGENTS.md is the handoff graph. It says, given a task, which other agent should pick it up.

```markdown
# Fund President — Handoff Graph

| Trigger | Handoff to | Why |
|---------|-----------|-----|
| New deal lands in inbox | deal-partner skill | Run first-look framing |
| Deal moves to DD | dd-lead skill | Coordinate workstreams |
| LP question on portfolio | lp-relations skill | Compose response |
| Pricing/sizing math | financial-modeler skill | DCF / waterfall |
| Engineering ask | ship-cto agent | Build internal tool |
| Branding ask | design-lead agent | Visual direction |
```

## Adding a new agent

1. Copy `claude/agents/_template/` to `claude/agents/examples/<your-agent>/`.
2. Edit AGENT.md frontmatter (name, description, tools).
3. Write SOUL.md — what is this agent's identity?
4. Write AGENTS.md — what does it hand off, and to whom?
5. Add `<your-agent>` to `AGENTS=` in `jerryos.conf`.
6. Re-run `./setup.sh`. The agent will be scaffolded under `~/.claude/agents/<your-agent>/`.

## Slock runtime integration

If you also run [slock](https://github.com/slockit/slock), agent dirs render to `~/.slock/agents/<uuid>/prompt.md` via `render-prompt.sh`. JerryOS doesn't depend on slock — the convention works standalone in Claude Code via the agent-spawn pattern.

## Memory hygiene

Each agent's `MEMORY.md` is independent of your global `~/.claude/projects/-Users-<you>/memory/`. Use it for agent-scoped feedback ("the user prefers terse IC memos"), not facts that belong in global memory.
