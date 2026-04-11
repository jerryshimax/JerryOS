#!/bin/bash
# Install Telegram bot as a macOS LaunchAgent
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_NAME="${BOT_NAME:-tg-bot}"
PLIST_NAME="com.${BOT_NAME}.plist"
LOG_DIR="${HOME}/logs"

echo "=== Installing ${BOT_NAME} as LaunchAgent ==="

# 1. Create log directory
echo "Creating log directory..."
mkdir -p "${LOG_DIR}"

# 2. Create state directory
echo "Creating state directory..."
mkdir -p "${HOME}/.claude/channels/telegram/history"

# 3. Clear stale lock
echo "Clearing stale lock..."
rm -f "${HOME}/.claude/channels/telegram/bot-polling.lock"

# 4. Unload old agent if exists
launchctl unload "${HOME}/Library/LaunchAgents/${PLIST_NAME}" 2>/dev/null || true

# 5. Generate plist from template
echo "Generating LaunchAgent plist..."
BUN_PATH="$(which bun 2>/dev/null || echo "${HOME}/.bun/bin/bun")"
sed \
  -e "s|/path/to/.bun/bin/bun|${BUN_PATH}|g" \
  -e "s|/path/to/cloud-bot/bot.ts|${SCRIPT_DIR}/bot.ts|g" \
  -e "s|/path/to/home|${HOME}|g" \
  -e "s|/path/to/.local/bin|${HOME}/.local/bin|g" \
  -e "s|/path/to/.bun/bin|${HOME}/.bun/bin|g" \
  -e "s|/path/to/logs/tg-bot.log|${LOG_DIR}/${BOT_NAME}.log|g" \
  "${SCRIPT_DIR}/com.tg-bot.plist" > "${HOME}/Library/LaunchAgents/${PLIST_NAME}"

# 6. Load the agent
echo "Loading LaunchAgent..."
launchctl load "${HOME}/Library/LaunchAgents/${PLIST_NAME}"

# 7. Wait and verify
echo "Waiting 3 seconds..."
sleep 3
echo ""
echo "=== Recent logs ==="
tail -10 "${LOG_DIR}/${BOT_NAME}.log" 2>/dev/null || echo "(no logs yet)"
echo ""
echo "=== Process check ==="
pgrep -f "cloud-bot/bot.ts" && echo "Bot is running!" || echo "WARNING: Bot not running!"
echo ""
echo "Done. Send a message on Telegram to test."
