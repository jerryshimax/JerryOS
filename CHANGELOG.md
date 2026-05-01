# Changelog

## v3.0.0 — 2026-05-01

Adds the **always-on home server** deployment pattern. Operational, not code — the OS layer itself is unchanged. New doc captures the M2 setup Jerry runs in production: slock daemon flipped from laptop to always-on Mac, Downloads bridged via rsync over Tailscale, two macOS gotchas worth knowing before you try this yourself.

### Added
- **`docs/DEPLOYMENT.md`** — Pattern 1 (single laptop, default), Pattern 2 (always-on home server with slock daemon). Documents file-access bridges for Brain (GDrive native), `~/.claude/` (GitHub repo sync via `com.jerry.claude-config-sync`), and `~/Downloads/` (rsync over Tailscale, 5-min cadence).
- Two operational gotchas captured:
  - `claude --version` ≠ authenticated. Use `echo x | claude --print --model haiku` in any preflight that gates daemon deploy. Subscription auth lives in Keychain (`Claude Code-credentials`); GUI launchd domain (`gui/$(id -u)`) reaches it, plain ssh sessions may not.
  - macOS TCC blocks `~/Downloads/` writes via SSH even after granting sshd Full Disk Access. Workaround: sync to a non-canonical dir (e.g. `~/M5-Downloads/`); custom dirs aren't TCC-protected. Trade-off: agents need a one-line infrastructure note in `MEMORY.md` pointing to the alt path.
- **`modules/_README.md`** — added `slock-daemon` row pointing to `@slock-ai/daemon` (the runtime that consumes the `claude/agents/` templates JerryOS ships).

### Changed
- README — bumped to v3, added Deployment section linking to new doc.

### Migration

No-op for users running the default single-laptop pattern. v2 setups continue working unchanged.

For users wanting Pattern 2: read `docs/DEPLOYMENT.md`. Reference scripts in iCloud `Cloud/` (`preflight-slock-flip.sh`, `flip-slock-to-m2.sh`, `install-slock-on-m2.sh`) walk the flip step-by-step.

---

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
