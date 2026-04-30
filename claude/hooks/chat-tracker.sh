#!/usr/bin/env bash
# chat-tracker.sh — PostToolUse hook on chat-reply tools
# Records which chat the agent is currently responding to.
# The active chat ID is read by chat-privacy-hook.sh to enforce per-chat
# file-access scoping.

set -euo pipefail

INPUT=$(cat /dev/stdin)

# Extract chat_id from any tool input that exposes one (Telegram, Slack, etc).
chat_id=$(echo "$INPUT" | jq -r '.tool_input.chat_id // .tool_input.channel // ""')

if [[ -n "$chat_id" ]]; then
  echo "$chat_id" > "$HOME/.claude/.active-chat"
fi

exit 0
