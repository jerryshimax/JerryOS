# Claude Code Memory System

Claude Code has a persistent memory system that stores learned facts across conversations.

## How It Works

Memory files live in `~/.claude/projects/[project]/memory/`. Each file has frontmatter:

```markdown
---
name: Memory Title
description: One-line description (used to decide relevance)
type: user | feedback | project | reference
---

Memory content here.
```

## Memory Types

| Type | What to store | Example |
|------|--------------|---------|
| `user` | Your role, preferences, knowledge | "User is a crypto trader focused on DeFi" |
| `feedback` | Behavioral rules from corrections | "Don't summarize after every response" |
| `project` | Ongoing work, goals, deadlines | "Migration to new exchange API by March" |
| `reference` | External resource locations | "Trade logs are in the Notion database" |

## Index File

`MEMORY.md` is an index of all memory files. Each entry is one line:
```
- [Title](filename.md) — one-line description
```

## What NOT to Store

- Code patterns (derive from reading code)
- Git history (use `git log`)
- Debugging solutions (the fix is in the code)
- Anything already in CLAUDE.md

## Claude Manages This Automatically

You don't need to manually create memory files. Claude will:
- Save memories when it learns something important about you
- Update memories when corrections are made
- Remove stale memories over time
