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
git clone https://github.com/jerryshi/JerryOS.git
cd JerryOS
```

### 2.2 Copy the config template

```
cp jerry-os.conf.example jerry-os.conf
```

### 2.3 Edit your config

```
open jerry-os.conf
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
2. Read your jerry-os.conf
3. Generate your personalized CLAUDE.md
4. Install safety hooks (protects files + crypto keys)
5. Install 22 AI skills
6. Create your Obsidian vault with templates
7. Build any modules you enabled
8. Create the backup vault at ~/.vault/

Watch for any red X errors. Green checkmarks mean that step succeeded.

---

## Part 4: Open Your Vault in Obsidian (2 minutes)

1. Open Obsidian
2. Click **"Open folder as vault"**
3. Navigate to the path you set in jerry-os.conf (default: `~/Brain`)
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

### Cloud Bot (Telegram AI Assistant)

Your own AI assistant on Telegram — message it anytime, anywhere.

**Setup:**
1. Open Telegram, search for @BotFather
2. Send `/newbot` and follow the prompts to create a bot
3. Copy the bot token
4. `cd ~/JerryOS/cloud-bot`
5. `cp .env.example .env`
6. Paste your bot token into `.env`
7. `cp access.example.json access.json`
8. Edit `access.json` with your Telegram chat ID
9. Install Bun if needed: `curl -fsSL https://bun.sh/install | bash`
10. Run: `bun run bot.ts`

**How to find your chat ID:** Message your bot, then visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` — your chat ID is in the response.

### Arena (Multi-AI Analysis)

Run a question through 4 different AI models and get a synthesized answer.
Great for market analysis — each AI argues a different perspective.

**Setup:** See `modules/arena/README.md`
**Requires:** API keys for OpenAI, Google AI, and xAI (optional — works with just 2 models)

### Memory MCP (Vault Search)

Full-text search across every markdown file in your vault. Claude can find anything you've written.

**Setup:** Already built by `setup.sh` if you enabled it.
**Test:** Ask Claude "Search my vault for [topic]"

### Google Tasks MCP

Manage your to-do list through Claude — create tasks, check them off, set deadlines.

**Setup:** See `modules/mcp-google-tasks/README.md`
**Requires:** Google Cloud project + OAuth credentials (15 min setup)

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

Open Claude and type:
```
/doctor
```

Or run directly:
```
~/JerryOS/modules/scripts/doctor.sh
```

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
ls ~/.claude/hooks/
```

You should see `safety-gate.sh`, `backup-before-edit.sh`, `brain-guard.sh`.
If missing, re-run `./setup.sh`.

### MCP server won't start

Most common issue: not built yet.
```
cd modules/mcp-memory && npm install && npm run build
```

### Obsidian shows "No results" for Dashboard queries

Install the Dataview plugin:
1. Settings → Community plugins → Browse
2. Search "Dataview" → Install → Enable

### Need help?

Open an issue on GitHub: https://github.com/jerryshi/JerryOS/issues
