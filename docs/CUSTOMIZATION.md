# Customization Guide

JerryOS is meant to be edited. Most customization happens in three places: `jerryos.conf`, the `claude/` directory, and `~/.claude/`.

## Adding entities

Edit `jerryos.conf`:

```bash
ENTITIES=(
  "FUND:Acme Capital:Main VC fund"
  "INFRA:Acme Infra:Infra PE fund"
  "OPS:NewCo:Portfolio opco"
  "NEW:Side Project:Weekend venture"   # Add new entity
)
```

Re-run `./setup.sh` — idempotent. New index file created, CLAUDE.md re-rendered, rules re-substituted with the new tag.

## Adding a skill

Two ways:

**A) Quick local-only skill.** Drop `~/.claude/skills/<your-skill>/SKILL.md`. Active immediately.

**B) Bundled skill (committed to your fork).**
1. `mkdir claude/skills/<your-skill>`
2. Create `claude/skills/<your-skill>/SKILL.md` with frontmatter:
   ```markdown
   ---
   name: your-skill
   description: One-line description of when this skill triggers.
   ---
   # Your Skill
   ...
   ```
3. Re-run `./setup.sh` to symlink it.

Use the existing skills under `claude/skills/` as references. The `write-a-skill` skill is a good starting point — it walks Claude through producing a well-structured SKILL.md.

## Adding a hook

1. Create `claude/hooks/<your-hook>.sh`. Make it executable.
2. Register it in `claude/settings.json.template` under the appropriate event:
   ```jsonc
   "hooks": {
     "PreToolUse": [
       {"matcher": "Bash", "command": "$HOME/.claude/hooks/your-hook.sh"}
     ]
   }
   ```
3. Re-run `./setup.sh`.

For helper functions shared across hooks, drop them in `claude/hooks/lib/` — that whole dir is symlinked into `~/.claude/hooks/lib/`.

## Adding an agent

1. Copy `claude/agents/_template/` to `claude/agents/examples/<your-agent>/`.
2. Edit `AGENT.md` (frontmatter), `SOUL.md` (identity), `AGENTS.md` (handoff graph), `MEMORY.md` (start empty).
3. Add `<your-agent>` to `AGENTS=` in `jerryos.conf`.
4. Re-run `./setup.sh`. Agent scaffolds under `~/.claude/agents/<your-agent>/`.

See [AGENTS.md](AGENTS.md) for slock-style anatomy.

## Adding an MCP server

1. Add the name to `MCPS=` in `jerryos.conf`.
2. Add a case to `setup.sh` Step 10's `case "$mcp" in ... esac` so the snippet prints next time.
3. Document it in [MCPS.md](MCPS.md).
4. Re-run `./setup.sh`, paste output into `~/.claude.json`.

## Adding safety patterns

Edit `claude/hooks/safety-gate.sh`. The `deny_patterns` array is regex — match against the full Bash command:

```bash
deny_patterns=(
  # ... existing patterns ...
  'your-dangerous-pattern'
  'another-pattern-to-block'
)
```

For path-based denies, use `~/.claude/settings.json` `permissions.deny` instead — they apply across all tools, not just Bash.

## Changing backup behavior

Edit `claude/hooks/backup-before-edit.sh`. Critical-path matches use shell glob:

```bash
case "$file_path" in
  */\[0[1-9]\]\ */*.md)  critical=true ;;   # bracketed numeric prefix dirs
  */your-important-dir/*.md)  critical=true ;;
esac
```

Last 200 backups kept by default — change the trim count near the bottom.

## Adding a Brain note type

1. Drop `brain/Templates/[YourType].md`.
2. Document the type in [BRAIN.md](BRAIN.md) and your personal CLAUDE.md.
3. (Optional) Add validation logic to `brain-guard.sh` if the type has unique frontmatter requirements.

## Customizing rules (autoload context)

Edit files under `claude/rules/`. They use `ENTITY_A`, `ENTITY_B`, `ENTITY_C` placeholders that `setup.sh` substitutes from `jerryos.conf`. Re-run setup after editing to re-render.

If you need a new autoload rule (e.g., `legal-review-checklist.md` that loads when touching `[Legal]` files), drop it in `claude/rules/` — it'll be auto-rendered next setup run.

## Per-chat privacy

`chat-privacy-hook.sh` reads `~/.claude/.chat-rules.json`:

```json
{
  "default": {"deny": [".vault", ".ssh", ".aws", ".gnupg"]},
  "<chat_id>": {"deny": ["[Medical]", "[Finance]"]},
  "<owner_chat_id>": {"allow_full": true}
}
```

Add chat IDs as needed. Owner chats with `allow_full: true` bypass non-baseline denies (the baseline `.vault/.ssh/.aws/.gnupg` still applies).

## Resetting

If you want to rebuild from scratch: back up `~/CLAUDE.md` and `~/.claude/memory/` first, then `mv ~/.claude ~/.claude.bak.$(date +%s)` and re-run `./setup.sh`.
