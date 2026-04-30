# Architecture

## Layered model

JerryOS v2 is a Claude Code OS. It composes a Claude session out of five layers, each loaded on demand by the runtime:

```
┌─ Layer 1: CONTEXT ────────────────────────────────────┐
│  CLAUDE.md (top-level identity)                        │
│  rules/*.md (auto-loaded when matching paths)          │
│  memory/MEMORY.md (index) + per-fact files             │
└────────────────────────────────────────────────────────┘
                          ↓
┌─ Layer 2: CAPABILITY ─────────────────────────────────┐
│  skills/<name>/SKILL.md  ×62                           │
│    Engineering:   debug-hypothesis, harden, audit...   │
│    Design:        frontend-design, minimalist-ui...    │
│    VC/PE:         deal-partner, ic-chair, syndicate... │
│    Personal-OS:   notecraft, retro, onboard...         │
└────────────────────────────────────────────────────────┘
                          ↓
┌─ Layer 3: SAFETY ─────────────────────────────────────┐
│  hooks/                                                │
│    PreToolUse:   safety-gate, chat-privacy             │
│    PostToolUse:  backup-before-edit, brain-guard       │
│    SessionStart: claude-session-start (handoff inject) │
│    SessionEnd:   session-export                        │
└────────────────────────────────────────────────────────┘
                          ↓
┌─ Layer 4: ORCHESTRATION ──────────────────────────────┐
│  agents/                                               │
│    fund-president, ops-president, ship-cto, ...        │
│  Each agent: AGENT.md + SOUL.md + AGENTS.md + MEMORY   │
└────────────────────────────────────────────────────────┘
                          ↓
┌─ Layer 5: INTEGRATION ────────────────────────────────┐
│  MCP servers (memory, google-tasks, gcal, gdrive, ...) │
│  Brain vault (Obsidian)                                │
│  Daemons (cloud-bot, downloads-filer — separate repos) │
└────────────────────────────────────────────────────────┘
```

## How a request flows

1. **User asks Claude to do something.**
2. **Claude session starts** (or resumes) — `claude-session-start.sh` injects handoff context if a previous session left a snapshot.
3. **Context layer loads** — `CLAUDE.md` is always loaded; relevant `rules/*.md` files load when matching paths are touched; relevant memory files load when the topic comes up.
4. **Skill match** — Claude invokes a matching skill (e.g., `debug-hypothesis`) which provides specialized prompt + workflow.
5. **Tool call** — If Claude uses a tool (Bash, Edit, Write), the **PreToolUse hooks** fire first:
   - `safety-gate` blocks destructive commands.
   - `chat-privacy-hook` enforces per-channel deny lists.
6. **Tool runs** — actual filesystem / shell op.
7. **PostToolUse hooks** fire:
   - `backup-before-edit` already snapshotted the file pre-edit (200 most recent kept).
   - `brain-guard` validates Brain writes, queues index refresh, appends to Activity Log.
8. **Agent handoff (optional)** — if the work is multi-agent, the current agent reads its `AGENTS.md` graph and delegates.
9. **MCP calls (optional)** — Claude calls memory / google-tasks / etc. through the MCP layer.
10. **Session ends** — `session-export` writes a handoff snapshot for the next session.

## Files-on-disk layout

```
~/CLAUDE.md                     # rendered from claude/CLAUDE.md.template
~/.claude/
  hooks/                        # symlinked → ~/Ship/JerryOS/claude/hooks/
    safety-gate.sh
    backup-before-edit.sh
    brain-guard.sh
    chat-privacy-hook.sh
    chat-tracker.sh
    claude-session-start.sh
    session-export.sh
    brain-index-refresh.sh
    log-hook-event.sh
    lib/
      handoff-lib.sh
      handoff-context.sh
  rules/                        # rendered from claude/rules/*.md
    gdrive-routing.md
    brain-naming.md
    common-tasks.md
  skills/                       # symlinked → ~/Ship/JerryOS/claude/skills/
    <62 skill dirs>
  agents/                       # scaffolded from claude/agents/examples/
    <agent dirs based on AGENTS= in jerryos.conf>
  settings.json                 # rendered from claude/settings.json.template
  .entities                     # newline-separated entity tags (used by brain-guard)
  .chat-rules.json              # per-chat deny rules (used by chat-privacy-hook)
~/.claude.json                  # MCP server config — paste snippets manually
~/.vault/file-backups/          # pre-edit snapshots (last 200)
$BRAIN_PATH/                    # Obsidian vault
  Templates/
  Indexes/
  Dashboard.md
  Activity Log.md
  [Type] Entity - Description.md
$WORK_PATH/                     # Google Drive / Dropbox
$SHIP_PATH/                     # code projects
```

## Why symlinks?

Hooks and skills are symlinked from the repo into `~/.claude/`. That means `git pull` in `~/Ship/JerryOS` instantly updates your live install — no re-running setup. Rules are *rendered* (not symlinked) because they get entity-tag substitutions baked in.

Agents are *scaffolded* (copied) because each agent's AGENT.md / SOUL.md is meant to be edited locally per user.

## Data isolation

| Data | Location | AI access |
|------|----------|-----------|
| Working files | `~/Work/` (cloud-synced) | Read/write |
| Knowledge | `~/Brain/` | Read/write via `brain-guard` |
| Pre-edit snapshots | `~/.vault/file-backups/` | **Denied** (safety-gate blocks reads) |
| SSH/AWS/GnuPG/.solana | `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.solana` | **Denied** |
| Hooks themselves | `~/.claude/hooks/` | **Denied for edit** |
| Settings | `~/.claude/settings.json` | **Denied for edit** |

The deny list is enforced at multiple layers — settings.json `permissions.deny`, plus the `safety-gate.sh` hook as a belt-and-suspenders check.
