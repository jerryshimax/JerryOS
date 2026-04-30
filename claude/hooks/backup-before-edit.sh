#!/usr/bin/env bash
# backup-before-edit.sh — PreToolUse Write|Edit hook
# Snapshots critical files BEFORE the agent modifies them.
# Backups go to ~/.vault/file-backups/ — a directory the safety-gate denies.
# Keeps last 200 backups, auto-cleans older ones.

set -euo pipefail

BACKUP_DIR="$HOME/.vault/file-backups"
mkdir -p "$BACKUP_DIR"

file_path=$(jq -r '.tool_input.file_path // ""' < /dev/stdin)

# Only backup if file exists (new files don't need backup)
if [[ -z "$file_path" ]] || [[ ! -f "$file_path" ]]; then
  exit 0
fi

# Critical path patterns to protect.
# Numbered prefixes (e.g. */[01] */) match the templated entity layout from
# claude/rules/gdrive-routing.md — adjust the case statement if your tree differs.
critical=false
case "$file_path" in
  # System infrastructure
  */CLAUDE.md)                      critical=true ;;
  */.claude/skills/*)               critical=true ;;
  */.claude/hooks/*)                critical=true ;;
  */.claude/agents/*)               critical=true ;;
  */.claude/rules/*)                critical=true ;;
  */.claude/settings*)              critical=true ;;
  */.claude/projects/*/memory/*)    critical=true ;;

  # Brain vault (all types) — matches "[00] Brain"
  */\[00\]\ Brain/*)                critical=true ;;

  # Scripts
  */scripts/*.py)                   critical=true ;;
  */scripts/*.sh)                   critical=true ;;

  # Entity-level docs — any "[NN] ..." top-level folder
  */\[0[1-9]\]\ */*.md)             critical=true ;;
  */\[1[0-9]\]\ */*.md)             critical=true ;;
esac

if [[ "$critical" == "true" ]]; then
  timestamp=$(date +%Y%m%d_%H%M%S)
  safe_name=$(echo "$file_path" | sed 's|/|__|g')
  cp "$file_path" "$BACKUP_DIR/${timestamp}__${safe_name}"

  # Clean old backups (keep last 200)
  ls -t "$BACKUP_DIR" 2>/dev/null | tail -n +201 | while read -r old; do
    rm -f "$BACKUP_DIR/$old"
  done
fi

exit 0
