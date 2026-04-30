---
# Agent identity — required
name: AgentName
type: president          # president | specialist | generalist
domain: domain-slug      # e.g., venture, infra, ops, engineering, design, legal, capital, generalist
runtime: claude-code
model: claude-opus-4-7   # claude-opus-4-7 for hard reasoning, claude-sonnet-4-6 for fast/light

# Tools — required
mcps: []                 # e.g., [memory, google-tasks, superhuman]
skills: []               # e.g., [deal-partner, dd-lead, ic-chair]

# Coordination — optional
hands_off_to: []         # other agents this one delegates to

# Source of truth for identity (optional)
identity_source: ~/.claude/agents/<AgentName>/SOUL.md
---

# Agent metadata

This file is read by `render-prompt.sh` first. Anything below the frontmatter is treated as agent context (rare — most content lives in `SOUL.md`).

Keep this file minimal. The frontmatter is the contract.
