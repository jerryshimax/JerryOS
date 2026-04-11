# Telegram Bot for Claude Code

A standalone Telegram bot that connects to Claude Code via `claude -p`. Runs as its own process (or macOS LaunchAgent), polls Telegram via [grammy](https://grammy.dev/), and dispatches messages to Claude for AI-powered responses.

## Features

- **Warm session caching**: Reuses Claude session IDs for prompt cache hits (~10s vs ~60s per message)
- **Cold fallback**: Spawns fresh `claude -p` processes when the warm path is unavailable
- **Per-chat access control**: Allowlist-based DM and group chat gating via `access.json`
- **Job queuing**: Per-chat queuing with max concurrency limits
- **Photo/document/voice handling**: Downloads media, passes to Claude as attachments
- **Crash loop protection**: Detects repeated crashes, alerts admin, exits cleanly
- **PID locking**: Prevents duplicate bot instances
- **Telegram API fallback**: DNS-over-HTTPS IP discovery for resilient connectivity
- **Self-watchdog**: Restarts if polling goes silent

## Prerequisites

- [Bun](https://bun.sh/) runtime
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed at `~/.local/bin/claude`
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

## Setup

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Find Your Chat ID

1. Message your new bot on Telegram
2. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Look for `"chat":{"id":YOUR_CHAT_ID}` in the response
4. For groups: add the bot to the group, send a message, check getUpdates again

### 3. Configure the Bot

```bash
# Create state directory
mkdir -p ~/.claude/channels/telegram/history

# Create .env file with your bot token
# Place at: ~/.claude/channels/telegram/.env
# Contents:
#   TELEGRAM_BOT_TOKEN=your_token_here

# Create access.json (controls who can message the bot)
cp access.example.json ~/.claude/channels/telegram/access.json
# Edit access.json: replace YOUR_CHAT_ID with your actual chat ID
```

### 4. Configure MCP Servers (Optional)

If you want Claude to be able to send messages directly via MCP (more reliable delivery):

```bash
cp mcp-config.example.json mcp-config.json
# Edit mcp-config.json with your MCP server paths
```

Update `tools.ts` to include any additional MCP tools you want the bot to have access to.

### 5. Customize the Bot Personality (Optional)

- Edit the system prompt in `prompt.ts` (cold path) and `warm-session.ts` (warm path)
- Create a `bot-context.md` file with operating context that gets injected into every prompt
- Set `BOT_NAME` environment variable to change the bot's display name

### 6. Install Dependencies and Run

```bash
bun install
bun run bot.ts
```

### 7. Install as LaunchAgent (Optional, macOS)

For always-on operation:

```bash
chmod +x install.sh
./install.sh
```

This creates a macOS LaunchAgent that auto-starts the bot on login and restarts on crash.

## Configuration Files

| File | Location | Purpose |
|------|----------|---------|
| `.env` | `~/.claude/channels/telegram/.env` | Bot token and API keys |
| `access.json` | `~/.claude/channels/telegram/access.json` | Who can message the bot |
| `mcp-config.json` | `./mcp-config.json` | MCP server configuration for Claude |
| `bot-context.md` | `./bot-context.md` | Operating context injected into prompts |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | - | Bot token from @BotFather |
| `BOT_NAME` | No | `Assistant` | Display name used in status messages and prompts |
| `ADMIN_CHAT_ID` | No | - | Chat ID to receive crash loop alerts |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-20250514` | Claude model for the warm session path |
| `CHAT_RULES_PATH` | No | - | Path to a markdown file with per-chat rules |

## Architecture

```
Telegram <-> grammy (long-poll) <-> bot.ts
                                      |
                              dispatch.ts
                              /         \
                    warm-session.ts    cold spawn
                    (session reuse)    (claude -p)
                             \         /
                          Claude Code CLI
                                |
                          MCP tools (optional)
```

- **Warm path**: Reuses a session ID for prompt cache hits. Handles one message at a time.
- **Cold path**: Spawns a detached `claude -p` process per message. Used as fallback when warm is busy.
- **Job reaper**: Polls every 3s for completed cold-path jobs, sends replies.
- **Fallback transport**: Retries Telegram API calls through alternate IPs on network failure.

## Commands

| Command | Description |
|---------|-------------|
| `/status` | Show bot uptime, warm session status, and recent request stats |
