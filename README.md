# JerryOS

An AI operating system for power users. Claude Code + Obsidian + macOS automation.

Turn Claude Code into a full personal OS with structured knowledge management, safety hooks that protect your files and crypto keys, multi-model analysis, and extensible agent skills.

## What You Get

- **Safety hooks** that block dangerous commands before they execute (including crypto key exfiltration)
- **Automatic file backup** before any AI edit, stored where AI can't touch them
- **Knowledge vault** (Obsidian) with structured naming, auto-indexing, and frontmatter validation
- **22 skills** for engineering, design, code review, multi-model analysis, and more
- **Memory system** that learns your preferences across conversations
- **Intellectual Honesty Contract** — Claude tells you when it's guessing vs when it's confident

## Optional Modules

| Module | What it does |
|--------|-------------|
| **Cloud Bot** | Telegram AI assistant — message Claude from your phone |
| **Arena** | Run 4 AI models through adversarial debate on any topic |
| **MCP Memory** | Full-text search across your entire vault |
| **MCP Google Tasks** | Manage to-dos through Claude |
| **Skill Engine** | Self-improving skill detection and indexing |

## Quick Start (experienced users)

```bash
git clone https://github.com/jerryshi/JerryOS.git
cd JerryOS
cp jerry-os.conf.example jerry-os.conf
# Edit jerry-os.conf with your details
./setup.sh
```

## Full Install Guide (beginners)

See [docs/INSTALL.md](docs/INSTALL.md) for a step-by-step guide that assumes no coding experience.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Claude Code                    │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ CLAUDE.md │  │  Skills  │  │    Memory     │ │
│  │ (context) │  │ (22 ops) │  │ (persistent)  │ │
│  └───────────┘  └──────────┘  └──────────────┘ │
│                                                  │
│  ┌───────────────────────────────────────────┐  │
│  │              Safety Hooks                  │  │
│  │  safety-gate → backup → brain-guard       │  │
│  └───────────────────────────────────────────┘  │
├─────────────────────────────────────────────────┤
│               Obsidian Brain Vault               │
│  [Type] Entity - Description.md                  │
│  Templates/ │ Indexes/ │ Dashboard.md            │
├─────────────────────────────────────────────────┤
│                    Modules                       │
│  Cloud Bot │ Arena │ MCP Memory │ Google Tasks   │
└─────────────────────────────────────────────────┘
```

## File Naming Convention

All vault files follow: `[Type] Entity - Description.md`

| Type | Example |
|------|---------|
| `[Research]` | `[Research] ACME - DeFi Lending Analysis.md` |
| `[Meetings]` | `[Meetings] ACME - 2025-03-18 Partner Call.md` |
| `[People]` | `[People] John Smith.md` |
| `[Memos]` | `[Memos] ACME - Project Alpha Evaluation.md` |
| `[Ship]` | `[Ship] Trading Dashboard Spec.md` |

## Security

JerryOS includes hardened security for crypto users:

- **Seed phrase protection** — AI cannot read, access, or exfiltrate wallet directories
- **Private key blocking** — Patterns like `0x[64 hex chars]` are blocked in shell commands
- **Wallet directory isolation** — `.solana/`, `.ethereum/`, `.bitcoin/` are deny-listed
- **Pre-edit backups** — Every file edit is backed up to `~/.vault/` (AI-inaccessible)
- **Self-protection** — AI cannot disable its own safety hooks

See [docs/SECURITY.md](docs/SECURITY.md) for details.

## Customization

- **Add entities**: Edit `jerry-os.conf` and re-run `setup.sh`
- **Add skills**: Create `~/.claude/skills/your-skill/SKILL.md`
- **Add hooks**: Add scripts to `~/.claude/hooks/`
- **Modify safety rules**: Edit `claude/hooks/safety-gate.sh`

See [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) for guides.

## License

MIT
