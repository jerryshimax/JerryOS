# Claude Code Configuration

This directory contains the configuration layer for Claude Code.

## Contents

| File/Dir | Purpose |
|----------|---------|
| `CLAUDE.md.template` | Root operating context template — `setup.sh` fills in your details |
| `settings.json.template` | Permissions, hooks, and deny lists |
| `settings.local.json.example` | MCP server configuration |
| `hooks/` | Safety hooks (safety-gate, backup, brain-guard) |
| `skills/` | 22 general-purpose skills |
| `memory/` | Memory system documentation |

## How It Gets Installed

`setup.sh` copies hooks to `~/.claude/hooks/`, skills to `~/.claude/skills/`, and generates settings from templates.
