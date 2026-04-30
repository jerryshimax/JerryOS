# Changelog

## v2.0.0 — 2026-04-29

Major repackaging. v2 reflects the architecture Jerry actually runs: more hooks, more skills, slock-style agents, autoload rules, MCP wiring patterns. Daemons split out into separate repos.

### Added
- **62 skills** (was 22) — engineering (debug-hypothesis, harden, audit, polish, codex-review), design (frontend-design, stitch-design-taste, minimalist-ui, industrial-brutalist-ui), VC/PE (deal-partner, dd-lead, ic-chair, syndicate, council, arena, financial-modeler, lp-relations, portfolio-monitor, vc-returns, etc.), personal-OS (notecraft, retro, onboard, full-output-enforcement, prompt-caching-discipline)
- **9 hooks** (was 3) — added `chat-privacy-hook`, `chat-tracker`, `claude-session-start`, `session-export`, `brain-index-refresh`, `log-hook-event`, plus shared helpers in `claude/hooks/lib/`
- **8 slock-style agent templates** under `claude/agents/examples/` — fund-president, infra-president, ops-president, ship-cto, capital-president, generalist, design-lead, legal-counsel
- **3 autoload rules** — `gdrive-routing.md`, `brain-naming.md`, `common-tasks.md` (rendered with entity tags from `jerryos.conf`)
- **`upgrade.sh`** — v1 → v2 migration with auto-backup
- **MCP wiring patterns** — setup.sh prints config snippets for memory, google-tasks, context7, playwright, etc.
- **New docs** — `AGENTS.md`, `MCPS.md`, `BRAIN.md`
- **Templated config schema** — `ENTITIES`, `AGENTS`, `MCPS` arrays in `jerryos.conf`
- **Symlink-based install** — hooks/skills now symlinked from repo, so `git pull` updates them live

### Changed
- Renamed config from `jerry-os.conf` → `jerryos.conf`
- Rewrote `README.md`, `docs/INSTALL.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/CUSTOMIZATION.md`
- `setup.sh` is now idempotent and renders rules + scaffolds agents in addition to v1's CLAUDE.md/hooks/skills/Brain init
- Skills install via symlink (was copy)

### Removed
- Bundled daemon source (cloud-bot, mcp-memory, mcp-google-tasks, arena, scripts) — split into separate repos under `jerryshimax/*`. JerryOS v2 ships pointer docs only in `modules/`.
- v1 `jerry-os.conf.example`

### Migration

v1 users:
```bash
cd ~/Ship/JerryOS
git pull --tags
git checkout v2.0.0
cp jerryos.conf.example jerryos.conf   # edit as needed
./upgrade.sh
```

`upgrade.sh` backs up `~/.claude/` to `~/.claude.v1.bak.<timestamp>/` before layering v2 in. Your `~/CLAUDE.md`, `~/.claude/memory/`, and `~/.claude/projects/` are preserved.

---

## v1.0.0 — 2025-04-13

Initial public release. 22 skills, 3 hooks, Brain vault scaffolding, optional modules (cloud-bot, arena, mcp-memory, mcp-google-tasks).
