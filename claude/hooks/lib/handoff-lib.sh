#!/usr/bin/env bash
# handoff-lib.sh — shared helpers for handoff snapshot paths and project key derivation.
# Sourced by claude-session-start.sh (via handoff-context.sh) and session-export.sh.

set -euo pipefail

HANDOFF_ROOT="${HANDOFF_ROOT:-$HOME/Ship/logs/handoffs}"
SESSIONS_ROOT="${SESSIONS_ROOT:-$HOME/Ship/logs/sessions}"
CLAUDE_PROJECTS_ROOT="${CLAUDE_PROJECTS_ROOT:-$HOME/.claude/projects}"

handoff_abs_path() {
  local input_path="${1:?}"
  python3 - "$input_path" <<'PY'
import os
import sys

print(os.path.realpath(sys.argv[1]))
PY
}

handoff_sha1_short() {
  local input_data="${1:-}"
  python3 - "$input_data" <<'PY'
import hashlib
import sys

print(hashlib.sha1(sys.argv[1].encode("utf-8")).hexdigest()[:12])
PY
}

handoff_project_key() {
  local abs_path base_name safe_base hash
  abs_path="$(handoff_abs_path "${1:?}")"
  base_name="$(basename "$abs_path")"
  safe_base="$(printf '%s' "$base_name" | tr -cs 'A-Za-z0-9._-' '-' | sed -E 's/^-+//; s/-+$//; s/-+/-/g')"
  if [[ -z "$safe_base" ]]; then
    safe_base="root"
  fi
  hash="$(handoff_sha1_short "$abs_path")"
  printf '%s-%s' "$safe_base" "$hash"
}

handoff_project_latest_path() {
  local project_dir="${1:?}"
  printf '%s/projects/%s/latest.json' "$HANDOFF_ROOT" "$(handoff_project_key "$project_dir")"
}

handoff_project_history_path() {
  local project_dir="${1:?}"
  local session_id="${2:?}"
  printf '%s/history/%s/%s.json' "$HANDOFF_ROOT" "$(handoff_project_key "$project_dir")" "$session_id"
}

handoff_global_latest_path() {
  printf '%s/global/latest.json' "$HANDOFF_ROOT"
}

handoff_latest_context_path() {
  local project_dir="${1:-}"
  local candidate=""

  if [[ -n "$project_dir" ]]; then
    candidate="$(handoff_project_latest_path "$project_dir")"
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  candidate="$(handoff_global_latest_path)"
  if [[ -f "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  return 1
}
