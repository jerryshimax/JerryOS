#!/usr/bin/env bash
set -euo pipefail

# brain-guard.sh — PostToolUse hook for Brain vault writes
# Fires after Write|Edit to Brain vault *.md files
# Three jobs: validate frontmatter, auto-log to Activity Log, queue index refresh
# ALWAYS exits 0 (non-blocking). Warnings via stdout JSON.

# Configure these paths for your setup
BRAIN="${BRAIN_PATH:-$HOME/Brain}"
ACTIVITY_LOG="$BRAIN/Activity Log.md"
INDEX_QUEUE="$HOME/.claude/.brain-index-queue"

# ── Parse stdin ──────────────────────────────────────────
input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""')
tool_name=$(echo "$input" | jq -r '.tool_name // ""')

# ── Gate: only act on root-level Brain .md files ─────────
[[ -n "$file_path" ]] || exit 0
[[ "$file_path" == "$BRAIN/"* ]] || exit 0
[[ "$file_path" == *.md ]] || exit 0

# Skip subdirectories (Indexes/, Templates/, .obsidian/)
rel="${file_path#$BRAIN/}"
[[ "$rel" == */* ]] && exit 0

# Skip system files
basename=$(basename "$file_path" .md)
[[ "$basename" == "Activity Log" ]] && exit 0
[[ "$basename" == "Dashboard" ]] && exit 0

# ── Extract [Type] prefix from filename ──────────────────
prefix=$(echo "$basename" | grep -oE '^\[[A-Za-z]+\]' | tr -d '[]' || true)
[[ -n "$prefix" ]] || exit 0

# Map prefix to canonical type
canonical=""
case "$prefix" in
  Meetings)  canonical="meeting" ;;
  People)    canonical="person" ;;
  Memos)     canonical="memo" ;;
  Research)  canonical="research" ;;
  Ship)      canonical="ship" ;;
  Events)    canonical="event" ;;
  Decks)     canonical="deck" ;;
  Home)      canonical="home" ;;
  Travel)    canonical="travel" ;;
  Inbox)     canonical="inbox" ;;
  Legal)     canonical="legal" ;;
  Finance)   canonical="finance" ;;
  Documents) canonical="documents" ;;
  *)         canonical="" ;;
esac

# ── Job 1: Frontmatter validation ───────────────────────
warnings=()

if [[ -f "$file_path" ]]; then
  first_line=$(head -1 "$file_path")

  if [[ "$first_line" != "---" ]]; then
    warnings+=("missing frontmatter (no opening ---)")
  else
    fm=$(awk '/^---$/{n++; if(n==2) exit; next} n==1{print}' "$file_path")

    if ! echo "$fm" | grep -q '^type:'; then
      warnings+=("missing 'type' field")
    else
      current_type=$(echo "$fm" | awk '/^type:/{print $2; exit}')
      if [[ -n "$canonical" ]] && [[ "$current_type" != "$canonical" ]] && [[ "$current_type" != "deal-note" ]]; then
        warnings+=("type '$current_type' should be '$canonical'")
      fi
    fi

    case "$prefix" in
      Meetings)
        echo "$fm" | grep -q '^entity:' || warnings+=("missing 'entity'")
        echo "$fm" | grep -q '^date:' || warnings+=("missing 'date'")
        ;;
      Memos)
        echo "$fm" | grep -q '^entity:' || warnings+=("missing 'entity'")
        ;;
    esac
  fi
fi

if [[ ${#warnings[@]} -gt 0 ]]; then
  warn_str=$(IFS=', '; echo "${warnings[*]}")
  echo "{\"warning\": \"Brain guard: $basename — $warn_str\"}"
fi

# ── Job 2: Auto Activity Log ────────────────────────────
operation="Updated"
[[ "$tool_name" == "Write" ]] && operation="Created"

today=$(date +%Y-%m-%d)
now=$(date +%H:%M)
entry="- $now **$operation** $basename.md"

if [[ -f "$ACTIVITY_LOG" ]]; then
  if grep -q "^## $today" "$ACTIVITY_LOG"; then
    sed -i '' "/^## $today$/a\\
$entry" "$ACTIVITY_LOG"
  else
    { echo "## $today"; echo "$entry"; echo ""; cat "$ACTIVITY_LOG"; } > "$ACTIVITY_LOG.tmp"
    mv "$ACTIVITY_LOG.tmp" "$ACTIVITY_LOG"
  fi
fi

# ── Job 3: Index queue ───────────────────────────────────
# Extract entity tag from filename: [Type] ENTITY - Description
entity=$(echo "$basename" | sed -n 's/^\[[A-Za-z]*\] \([A-Z]*\) -.*/\1/p')

if [[ -n "$entity" ]]; then
  mkdir -p "$(dirname "$INDEX_QUEUE")"
  echo "$entity" >> "$INDEX_QUEUE"
fi

case "$prefix" in
  People) echo "People" >> "$INDEX_QUEUE" 2>/dev/null ;;
esac

# ── Job 4: Duplicate detection ───────────────────────────
core_desc=$(echo "$basename" | sed 's/^\[[A-Za-z]*\] //' | sed 's/^[A-Z]* - //' | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\} //')

if [[ -n "$core_desc" ]] && [[ ${#core_desc} -gt 3 ]]; then
  similar=$(ls "$BRAIN/" 2>/dev/null | grep -i "$core_desc" | grep -v "^$(basename "$file_path")$" || true)
  if [[ -n "$similar" ]]; then
    first_match=$(echo "$similar" | head -1)
    echo "{\"warning\": \"Brain guard: possible duplicate — similar file exists: $first_match\"}"
  fi
fi

exit 0
