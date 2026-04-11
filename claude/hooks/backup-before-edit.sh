#!/usr/bin/env bash
set -euo pipefail

# backup-before-edit.sh — PreToolUse hook for Write|Edit
# Snapshots critical files BEFORE Claude modifies them.
# Backups go to ~/.vault/ — a directory Claude agents cannot access.
# Keeps last 200 backups per file, auto-cleans older ones.

BACKUP_DIR="$HOME/.vault/file-backups"
mkdir -p "$BACKUP_DIR"

# Extract the file path from the tool input
file_path=$(jq -r '.tool_input.file_path // ""' < /dev/stdin)

# Only backup if file exists (new files don't need backup)
if [[ -z "$file_path" ]] || [[ ! -f "$file_path" ]]; then
  exit 0
fi

# Critical path patterns to protect
# Customize this list for your setup
critical=false
case "$file_path" in
  # System infrastructure
  */CLAUDE.md)                      critical=true ;;
  */.claude/skills/*)               critical=true ;;
  */.claude/hooks/*)                critical=true ;;
  */.claude/settings*)              critical=true ;;
  */.claude/projects/*/memory/*)    critical=true ;;

  # Brain vault files
  */Brain/*.md)                     critical=true ;;

  # Scripts
  */scripts/*.py)                   critical=true ;;
  */scripts/*.sh)                   critical=true ;;
esac

if [[ "$critical" == "true" ]]; then
  # Create backup with timestamp
  timestamp=$(date +%Y%m%d_%H%M%S)
  safe_name=$(echo "$file_path" | sed 's|/|__|g')
  cp "$file_path" "$BACKUP_DIR/${timestamp}__${safe_name}"

  # Clean old backups (keep last 200)
  count=$(ls -1 "$BACKUP_DIR/"*"__${safe_name}" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$count" -gt 200 ]]; then
    ls -1t "$BACKUP_DIR/"*"__${safe_name}" | tail -n +201 | xargs rm -f
  fi
fi

exit 0
