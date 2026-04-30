#!/usr/bin/env bash
# log-hook-event.sh — append-only JSONL logger for Claude hook events
# Usage from settings.json hooks:
#   command: $HOME/.claude/hooks/log-hook-event.sh <event-name>
#
# Reads tool input JSON from stdin, writes one line per call to:
#   ~/Ship/logs/hook-events.jsonl
#
# Useful for observability of PostToolUseFailure / PermissionDenied events.

set -uo pipefail

EVENT="${1:-unknown}"
LOG="${JERRYOS_HOOK_LOG:-$HOME/Ship/logs/hook-events.jsonl}"
mkdir -p "$(dirname "$LOG")"

INPUT=$(cat /dev/stdin 2>/dev/null || echo "{}")

if command -v jq &>/dev/null; then
  jq -cn --arg ts "$(date -Iseconds)" --arg event "$EVENT" --argjson raw "${INPUT:-null}" \
    '{ts: $ts, event: $event, tool: ($raw.tool_name // ""), reason: ($raw.reason // $raw.error // ""), raw: $raw}' \
    >> "$LOG" 2>/dev/null
else
  python3 -c "
import json, sys, datetime, os
try: raw = json.loads(sys.argv[1]) if sys.argv[1] else {}
except: raw = {'parse_error': sys.argv[1][:200]}
rec = {'ts': datetime.datetime.now().isoformat(), 'event': sys.argv[2],
       'tool': raw.get('tool_name',''), 'reason': raw.get('reason') or raw.get('error',''),
       'raw': raw}
open(os.environ['LOG'], 'a').write(json.dumps(rec) + '\n')
" "$INPUT" "$EVENT" 2>/dev/null
fi

exit 0
