#!/usr/bin/env bash
# claude-session-start.sh — SessionStart hook
# Injects the latest handoff snapshot as authoritative carry-forward context
# so a fresh session can answer "what were we doing?" without prompting.
#
# Helper: claude/hooks/lib/handoff-context.sh (sibling to this script after symlink).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_INPUT="$(cat || true)"

CWD="$(python3 - <<'PY' "$HOOK_INPUT"
import json
import sys

raw = sys.argv[1]
if not raw.strip():
    print("")
    raise SystemExit(0)

try:
    payload = json.loads(raw)
except Exception:
    print("")
    raise SystemExit(0)

print(payload.get("cwd", ""))
PY
)"

CONTEXT=""
if [[ -x "$SCRIPT_DIR/lib/handoff-context.sh" ]]; then
  CONTEXT="$(bash "$SCRIPT_DIR/lib/handoff-context.sh" "${CWD:-$PWD}" 2>/dev/null || true)"
fi

python3 - <<'PY' "$CONTEXT"
import json
import sys

context = sys.argv[1].strip()
payload = {
    "continue": True,
    "suppressOutput": False,
}
if context:
    payload["hookSpecificOutput"] = {
        "hookEventName": "SessionStart",
        "additionalContext": (
            "<handoff-context>\n"
            "This is authoritative carry-forward state from the previous session.\n"
            "When the user asks what you were doing, what the last step was, or what to do next, answer from this handoff first.\n"
            "Only override it if the user explicitly changes direction or newer evidence in the workspace clearly contradicts it.\n\n"
            + context
            + "\n</handoff-context>"
        ),
    }

print(json.dumps(payload))
PY
