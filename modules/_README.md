# Modules

JerryOS v2 ships the **Claude Code OS layer** (skills, hooks, agents, rules, MCP wiring).

The runtime modules — Telegram bot, MCP servers, file watchers, mail assistant, fresh-Mac bootstrap — live as **standalone repositories** so they can iterate independently.

Wire them in after `setup.sh` finishes; each repo has its own install instructions.

| Module | What it is | Repo |
|--------|------------|------|
| `cloud-bot` | Telegram bot — message Claude from your phone, MCPs wired in | <https://github.com/jerryshimax/cloud-bot> |
| `slock-daemon` | Slock.ai runtime — consumes the `claude/agents/` templates, exposes them via slock.ai web + iPhone. See [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) for the always-on home server pattern. | `npx -y @slock-ai/daemon@latest` |
| `cloud-mail` | Star-to-draft Gmail assistant | <https://github.com/jerryshimax/cloud-mail-public> |
| `mcp-memory` | Local MCP server: BM25 search across Brain + memory + daily session logs | <https://github.com/jerryshimax/mcp-memory> |
| `mcp-google-tasks` | Local MCP server: Google Tasks CRUD with calendar sync | <https://github.com/jerryshimax/mcp-google-tasks> |
| `arena` | Multi-model adversarial analysis (Claude / Gemini / Grok / GPT debate) | <https://github.com/jerryshimax/arena> |
| `downloads-filer` | Watcher daemon: auto-routes `~/Downloads` to your storage tree by `[Type] Entity` tag | (private — ask repo owner) |
| `clip-watcher` | Obsidian clipper watcher: auto-research and TG-post each clipping | (private — ask repo owner) |
| `mac-bootstrap` | One-shot fresh Mac provisioning that clones the OS + modules | <https://github.com/jerryshimax/mac-bootstrap> |

## Order of operations

1. Run JerryOS `./setup.sh` first — this gives you the Claude Code layer.
2. Pick the modules you actually need. Most setups want `mcp-memory` + `mcp-google-tasks` + `cloud-bot`.
3. Each module's README has its own install/auth flow. They drop into `~/Ship/<module>/` and register with `~/.claude.json`.

## Why split

- **Cadence** — modules iterate weekly; the OS layer is more stable.
- **Optionality** — most users don't want a Telegram bot or fresh-Mac installer.
- **Boundaries** — each module owns its secrets, env, daemonization. The OS layer stays free of credentials.

See [`docs/MCPS.md`](../docs/MCPS.md) for how to wire any MCP server (custom or third-party) into Claude Code.
