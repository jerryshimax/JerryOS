# JerryOS v3

A Claude Code operating system. Skills, hooks, slock-style agents, autoload rules, and an Obsidian knowledge vault — wired together so a single `claude` session knows your context, protects your files, and routes work to specialist agents.

This is the OS layer Jerry Shi runs daily across multiple firms and projects, repackaged so anyone can clone, configure, and run it.

**v3 (2026-05-01)** adds [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — the always-on home server pattern Jerry uses to keep slock agents reachable while traveling. OS layer itself is unchanged from v2. See [CHANGELOG](CHANGELOG.md).

## What v2/v3 ships

- **62 skills** — Engineering (debug-hypothesis, simplify, harden, audit, codex-review), design (frontend-design, stitch-design-taste, minimalist-ui), VC/PE (deal-partner, ic-chair, dd-lead, lp-relations, syndicate, council, arena), and personal-OS (notecraft, retro, onboard).
- **9 hooks** — `safety-gate`, `backup-before-edit`, `brain-guard`, `chat-privacy-hook`, `chat-tracker`, `claude-session-start`, `session-export`, `brain-index-refresh`, `log-hook-event`. All event types covered: PreToolUse, PostToolUse, SessionStart, SessionEnd, Stop.
- **8 slock-style agent templates** — `fund-president`, `infra-president`, `ops-president`, `ship-cto`, `capital-president`, `generalist`, `design-lead`, `legal-counsel`. Each has AGENT.md (frontmatter), SOUL.md (identity), AGENTS.md (handoff graph), MEMORY.md.
- **3 autoload rules** — `gdrive-routing.md`, `brain-naming.md`, `common-tasks.md`. Loaded automatically when Claude touches matching files.
- **MCP wiring patterns** — Snippets for memory, google-tasks, superhuman, gmail, gcal, gdrive, context7, playwright. Setup script never writes secrets.
- **Brain vault skeleton** — Obsidian templates, dashboard, activity log, entity indexes.
- **Templated config** — Drop in your own entity tags, agents, MCPs via `jerryos.conf`.

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                    Claude Code session                  │
│                                                         │
│  ┌───────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │ CLAUDE.md │  │  rules  │  │ memory  │  │ skills  │ │
│  │ (context) │  │ (auto)  │  │ (BM25)  │  │  (~62)  │ │
│  └───────────┘  └─────────┘  └─────────┘  └─────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │   Hooks: safety-gate → backup → brain-guard       │ │
│  │          chat-privacy → session-export            │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌────────────────┐                ┌─────────────────┐ │
│  │  slock agents  │ ←─ handoffs ─→ │  MCP servers    │ │
│  │  fund/ops/ship │                │  memory, gtasks │ │
│  └────────────────┘                └─────────────────┘ │
├────────────────────────────────────────────────────────┤
│                  Obsidian Brain vault                   │
│  [Type] Entity - Description.md                         │
│  Templates/ │ Indexes/ │ Dashboard.md │ Activity Log    │
└────────────────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the layered model.

## Quick start

```bash
git clone https://github.com/jerryshimax/JerryOS.git ~/Ship/JerryOS
cd ~/Ship/JerryOS

cp jerryos.conf.example jerryos.conf
$EDITOR jerryos.conf            # set entities, agents, MCPs

./setup.sh                      # idempotent — re-runnable
```

Already on v1? Use the upgrade script:

```bash
./upgrade.sh                    # backs up ~/.claude → ~/.claude.v1.bak.<ts>
```

Full step-by-step guide: [docs/INSTALL.md](docs/INSTALL.md).

## File naming convention

All Brain notes follow: `[Type] Entity - Description.md`

| Type | Example |
|------|---------|
| `[Research]` | `[Research] FUND - Sector Deep Dive.md` |
| `[Meetings]` | `[Meetings] FUND - 2026-04-29 Partner Call.md` |
| `[People]` | `[People] John Smith.md` |
| `[Memos]` | `[Memos] FUND - Project Alpha IC.md` |
| `[Decks]` | `[Decks] FUND - Acme Series B.md` |

Full spec in [docs/BRAIN.md](docs/BRAIN.md).

## Security

- **Safety gate** blocks `rm -rf`, `git push --force`, exfiltration patterns (curl POST, scp, rsync to remote), package install gates, and unknown-binary execution.
- **Pre-edit backup** snapshots every file Claude touches to `~/.vault/file-backups/` (200 most recent kept).
- **Crypto isolation** — `.solana/`, `.ethereum/`, `.bitcoin/` denied. `0x[64 hex]` patterns flagged in shell commands.
- **Self-protection** — Claude can't edit its own hooks, settings, or vault.
- **Chat privacy** — `chat-privacy-hook.sh` enforces per-channel deny lists from `~/.claude/.chat-rules.json`.

See [docs/SECURITY.md](docs/SECURITY.md).

## Customization

- Add an entity → edit `jerryos.conf` `ENTITIES=`, re-run `setup.sh`.
- Add a skill → drop a `SKILL.md` into `~/.claude/skills/<name>/`.
- Add an agent → copy `claude/agents/_template/` to a new dir, edit AGENT.md + SOUL.md.
- Add a hook → drop a script into `~/.claude/hooks/`, register in `~/.claude/settings.json`.
- Add an MCP → paste the snippet from setup output into `~/.claude.json`.

See [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md), [docs/AGENTS.md](docs/AGENTS.md), [docs/MCPS.md](docs/MCPS.md).

## Deployment

- **Default:** single laptop. `./setup.sh` and you're done.
- **Always-on home server:** dedicated Mac hosts the slock daemon so agents reply while you travel. File-access bridges for Brain, `~/.claude/`, and `~/Downloads/` via GDrive + GitHub sync + rsync over Tailscale.

Full guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Modules (separate repos)

JerryOS v2 ships the OS layer only. Daemons live in their own repos:

| Repo | Purpose |
|------|---------|
| `jerryshimax/cloud-bot` | Telegram AI assistant |
| `jerryshimax/mcp-memory` | Local BM25 memory + Brain search |
| `jerryshimax/mcp-google-tasks` | Custom Google Tasks MCP |
| `jerryshimax/downloads-filer` | Auto-filer for `~/Downloads` |
| `jerryshimax/mac-bootstrap` | One-shot fresh-Mac provisioning |

See [modules/_README.md](modules/_README.md).

## License

MIT
