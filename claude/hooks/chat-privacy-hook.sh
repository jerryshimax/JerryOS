#!/usr/bin/env bash
# chat-privacy-hook.sh — PreToolUse Read|Glob|Grep|Bash hook
# Enforces per-chat file-access scoping when the agent is responding inside a
# messaging context (e.g. a Telegram chat). Blocks reads of paths that the
# active chat is not authorized to see.
#
# How it works:
#   1. The bot writes the active chat ID to ~/.claude/.active-chat
#   2. ~/.claude/.chat-rules.json maps chat ID → list of deny path patterns
#   3. This hook checks the file_path / Bash command against the rules
#
# Rules format (~/.claude/.chat-rules.json):
#   {
#     "default": {
#       "deny": [".vault", ".ssh", ".aws", ".gnupg", "[Medical]", "[Finance]"]
#     },
#     "<chat_id_string>": {
#       "deny": ["[Medical]", "[Finance]"],
#       "allow_full": false
#     },
#     "<owner_chat_id>": {
#       "allow_full": true
#     }
#   }
#
# If no rules file exists, only the always-on baseline deny list is enforced.
# If active-chat is empty, the hook exits 0 (no scoping needed).

set -euo pipefail

STATE_FILE="$HOME/.claude/.active-chat"
RULES_FILE="$HOME/.claude/.chat-rules.json"
INPUT=$(cat /dev/stdin)

# Always-on baseline — credential-bearing dotfiles must never leak regardless
# of who is on the other side of the chat.
BASELINE_DENY=(
  ".vault"
  ".ssh"
  ".aws"
  ".gnupg"
  ".claude/projects"
)

# ── Extract path or command from tool input ────────────────
if command -v jq &>/dev/null; then
  file_path=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')
else
  file_path=$(echo "$INPUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); ti=d.get("tool_input",{}); print(ti.get("file_path") or ti.get("path") or "")')
fi

if [[ -z "$file_path" ]]; then
  if command -v jq &>/dev/null; then
    cmd=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
  else
    cmd=$(echo "$INPUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))')
  fi
  if [[ -n "$cmd" ]] && echo "$cmd" | grep -Eq '\b(cat|head|tail|less|more|bat|view|nl|od|xxd|strings)\b'; then
    file_path="$cmd"
  fi
fi

[[ -z "$file_path" ]] && exit 0

# ── Always-on baseline check ───────────────────────────────
for p in "${BASELINE_DENY[@]}"; do
  if [[ "$file_path" == *"$p"* ]]; then
    echo "{\"decision\":\"block\",\"reason\":\"Privacy hook: baseline deny — $p\"}"
    exit 2
  fi
done

# ── Active chat lookup ─────────────────────────────────────
active_chat=""
[[ -f "$STATE_FILE" ]] && active_chat=$(cat "$STATE_FILE" 2>/dev/null || echo "")
[[ -z "$active_chat" ]] && exit 0

# ── Load rules (graceful no-op if absent) ──────────────────
[[ -f "$RULES_FILE" ]] || exit 0
command -v jq &>/dev/null || exit 0

allow_full=$(jq -r --arg c "$active_chat" '.[$c].allow_full // false' "$RULES_FILE" 2>/dev/null || echo "false")
[[ "$allow_full" == "true" ]] && exit 0

# Pull deny patterns for this chat. Fall back to "default" rule if no per-chat
# entry. If neither exists, exit 0.
deny_patterns=$(jq -r --arg c "$active_chat" '
  (.[$c].deny // .default.deny // []) | .[]
' "$RULES_FILE" 2>/dev/null || true)

[[ -z "$deny_patterns" ]] && exit 0

while IFS= read -r p; do
  [[ -z "$p" ]] && continue
  if [[ "$file_path" == *"$p"* ]]; then
    echo "{\"decision\":\"block\",\"reason\":\"Privacy hook: $p blocked in chat $active_chat\"}"
    exit 2
  fi
done <<< "$deny_patterns"

exit 0
