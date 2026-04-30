# JerryOS — Step-by-Step Install Guide

Welcome! This guide assumes you have a Mac and about 30 minutes.
No coding experience required — just follow each step.

---

## Part 0: What You're Setting Up

JerryOS gives you:
- An AI assistant (Claude) that remembers your preferences and protects your files
- A knowledge vault (Obsidian) where all your notes, research, and contacts live
- Safety hooks that prevent the AI from accidentally deleting files or leaking secrets (especially crypto keys)
- Optional modules: Telegram bot, task management, multi-AI analysis

You can install everything, or just the parts you want.

---

## Part 1: Prerequisites (10 minutes)

### 1.1 Install Homebrew (Mac package manager)

Open Terminal (press Cmd+Space, type "Terminal", hit Enter).

Paste this and press Enter:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the prompts. When done, **close and reopen Terminal**.

### 1.2 Install required tools

```
brew install jq node python3 git
```

### 1.3 Install Claude Code

```
npm install -g @anthropic-ai/claude-code
```

Then run `claude` once to sign in with your Anthropic account.
(You need a paid Anthropic account — go to claude.ai to sign up)

### 1.4 Install Obsidian

Download from https://obsidian.md — it's free.
Just install it, **don't create a vault yet** (we'll do that in Part 3).

---

## Part 2: Download JerryOS (2 minutes)

### 2.1 Clone the repo

Open Terminal and run:

```
cd ~
git clone https://github.com/jerryshimax/JerryOS.git
cd JerryOS
```

### 2.2 Copy the config template

```
cp jerryos.conf.example jerryos.conf
```

### 2.3 Edit your config

```
open jerryos.conf
```

This opens in TextEdit. Fill in your details:
- **USER_NAME**: Your name
- **USER_ROLE**: What you do (e.g., "crypto trader and researcher")
- **USER_BIO**: A short paragraph about yourself
- **ENTITIES**: Your organizations or contexts (see examples in the file)
- **Modules**: Set each one to `true` or `false`

Save and close the file.

---

## Part 3: Run the Installer (5 minutes)

```
./setup.sh
```

If you get "Permission denied":
```
chmod +x setup.sh && ./setup.sh
```

The installer will:
1. Check that all prerequisites are installed
2. Read your jerryos.conf
3. Generate your personalized CLAUDE.md
4. Install safety hooks (protects files + crypto keys)
5. Install 62 skills (symlinked, so `git pull` keeps them current)
6. Render the 3 autoload rules (gdrive-routing, brain-naming, common-tasks)
7. Scaffold the agents you listed in `jerryos.conf`
8. Create your Obsidian vault with templates
9. Print MCP config snippets (you paste them into `~/.claude.json`)
10. Create the backup vault at ~/.vault/

Watch for any red X errors. Green checkmarks mean that step succeeded.

---

## Part 4: Open Your Vault in Obsidian (2 minutes)

1. Open Obsidian
2. Click **"Open folder as vault"**
3. Navigate to the path you set in jerryos.conf (default: `~/Brain`)
4. Click **"Open"**
5. You'll see your Dashboard, Templates folder, and Activity Log
6. When prompted about "Community plugins", click **"Trust author and enable plugins"** (Dataview is needed for the Dashboard)

---

## Part 5: Verify It Works (5 minutes)

### 5.1 Test Claude Code

Open Terminal and type:
```
claude
```

Once Claude is running, type:
```
What skills do you have?
```

You should see the installed skills listed.

### 5.2 Test safety hooks

In Claude, try asking:
```
Run rm -rf ~/
```

It should be **BLOCKED** by the safety hook. If you see a block message, the hooks are working.

### 5.3 Test crypto protection

In Claude, try asking:
```
Read ~/.solana/id.json
```

It should be **DENIED**. Your wallet directories are protected.

### 5.4 Test your vault

Ask Claude:
```
Create a test research note called [Research] Test Note.md in my Brain vault
```

Check your vault in Obsidian — the file should appear with proper frontmatter.
Then ask Claude to delete the test file.

### 5.5 (Optional) Test MCP servers

If you enabled mcp-memory:
```
Search my vault for 'test'
```

If you enabled mcp-google-tasks:
```
List my Google Tasks
```
(Google Tasks requires OAuth setup — see modules/mcp-google-tasks/README.md)

---

## Part 6: Optional Modules

Each module has its own README with detailed setup instructions.

v2 ships the OS layer only — daemons live in standalone repos. Clone what you want:

### Cloud Bot (Telegram AI Assistant)

Your own AI on Telegram — message it anytime, anywhere.

```bash
git clone https://github.com/jerryshimax/cloud-bot.git ~/Ship/cloud-bot
cd ~/Ship/cloud-bot
cp .env.example .env  # paste @BotFather token + your chat ID
bun install && bun run bot.ts
```

### Memory MCP (Vault Search)

BM25 search across markdown + memory + handoffs.

```bash
git clone https://github.com/jerryshimax/mcp-memory.git ~/Ship/mcp-memory
cd ~/Ship/mcp-memory && npm install && npm run build
```

Then paste the `memory` snippet from `setup.sh` output into `~/.claude.json`.

### Google Tasks MCP

Manage Google Tasks through Claude.

```bash
git clone https://github.com/jerryshimax/mcp-google-tasks.git ~/Ship/mcp-google-tasks
cd ~/Ship/mcp-google-tasks && npm install && npm run build
```

Requires a Google Cloud OAuth client. See that repo's README.

### Arena (Multi-Model Adversarial Analysis)

Lives inside the `arena` skill — uses external API keys (OpenAI, Google AI, xAI). No separate install.

### Downloads Filer / Mac Bootstrap

```bash
git clone https://github.com/jerryshimax/downloads-filer.git ~/Ship/downloads-filer
git clone https://github.com/jerryshimax/mac-bootstrap.git ~/Ship/mac-bootstrap
```

---

## Part 7: Daily Usage

### Creating notes

Just tell Claude what you need:
- "Create a meeting note for my call with John" → `[Meetings] ACME - 2025-04-12 Call with John.md`
- "Start a research note on Ethereum L2s" → `[Research] Ethereum L2 Landscape.md`
- "Add a contact for Jane Doe" → `[People] Jane Doe.md`

Claude follows the naming convention automatically.

### Finding things

- "Search my vault for DeFi" — uses the memory MCP
- "What meetings did I have this week?" — searches by date
- "Find notes about John Smith" — CRM lookup

### The safety net

- Every file Claude edits gets backed up to `~/.vault/`
- Dangerous commands are blocked before they run
- Your crypto keys and seed phrases are protected
- Claude can't even read wallet directories

### Running a health check

Inside Claude Code, ask: `Run a JerryOS sanity check — are hooks loaded, skills linked, rules rendered?`

---

## Troubleshooting

### "claude: command not found"
```
npm install -g @anthropic-ai/claude-code
```
Then close and reopen Terminal.

### "Permission denied" running setup.sh
```
chmod +x setup.sh && ./setup.sh
```

### Hooks aren't working

Check they're installed:
```
ls -la ~/.claude/hooks/
```

You should see 9 symlinks (safety-gate, backup-before-edit, brain-guard, chat-privacy-hook, chat-tracker, claude-session-start, session-export, brain-index-refresh, log-hook-event) plus a `lib/` symlink. If missing, re-run `./setup.sh`.

### MCP server won't start

The MCP repo isn't bundled in v2. Clone it separately, build it, then paste the snippet from `setup.sh` output into `~/.claude.json`. See [MCPS.md](MCPS.md).

### Obsidian shows "No results" for Dashboard queries

Install the Dataview plugin:
1. Settings → Community plugins → Browse
2. Search "Dataview" → Install → Enable

### Need help?

Open an issue on GitHub: https://github.com/jerryshimax/JerryOS/issues
