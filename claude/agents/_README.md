# Agents

JerryOS uses a **slock-style agent runtime**: each agent is a folder of plain markdown files with frontmatter, hot-reloadable, no daemon, no compile step.

## Anatomy of an agent

```
~/.claude/agents/<AgentName>/
├── AGENT.md      ← metadata frontmatter (name, model, MCPs, skills, hands_off_to)
├── SOUL.md       ← identity & voice — how this agent thinks and writes
├── AGENTS.md     ← per-agent rules that override or extend the global AGENTS.md
└── MEMORY.md     ← agent-scoped notes (optional; private state)
```

Plus three top-level files in `~/.claude/agents/`:

```
~/.claude/agents/
├── USER.md       ← who the user is (loaded into every agent's prompt)
├── AGENTS.md     ← global rules every agent follows
└── render-prompt.sh  ← composes USER + AGENTS + per-agent files into a runtime prompt
```

## How an agent is invoked

```
$ slock <AgentName> "<message>"
```

`render-prompt.sh` concatenates: `USER.md` → global `AGENTS.md` → agent's `AGENT.md` → `SOUL.md` → agent's `AGENTS.md` → `MEMORY.md` (if present), then runs `claude -p` with the composed prompt and the user's message.

Skills referenced in the agent's `AGENT.md` frontmatter auto-load when the topic surfaces, via Claude Code's normal skill mechanism.

## What ships in this repo

- `_template/` — the blank scaffold. Copy and fill in.
- `examples/` — eight worked archetypes:
  - `fund-president` — orchestrates a venture or PE fund (deal flow, IC, portfolio)
  - `infra-president` — orchestrates an infrastructure fund (project finance, ops)
  - `ops-president` — orchestrates an operating company
  - `ship-cto` — engineering orchestrator: builds internal tools across all entities
  - `capital-president` — fundraising / LP relations / strategic partnerships
  - `generalist` — daily operations, scheduling, light research, the "chief of staff"
  - `design-lead` — brand and visual design across entities
  - `legal-counsel` — contracts, governance, compliance review

## How to add an agent

1. Copy `_template/` to a new folder under your `~/.claude/agents/`.
2. Edit `AGENT.md` frontmatter (name, model, skills you want, MCPs).
3. Write `SOUL.md` from scratch — voice and identity matter, don't copy.
4. Add per-agent overrides to that agent's `AGENTS.md` if needed.
5. Reload: agents are read fresh on each invocation, no restart.

See `docs/AGENTS.md` for the full reference and the runtime contract.
