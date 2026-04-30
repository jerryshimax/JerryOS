#!/usr/bin/env bash
# brain-index-refresh.sh — Stop hook
# Drains the brain-index-queue and dispatches a one-shot Claude Code job
# to refresh the entity indexes that were touched during the session.
# Designed to be called from "Stop" or session-end events.

set -euo pipefail

QUEUE="$HOME/.claude/.brain-index-queue"
[[ -f "$QUEUE" ]] || exit 0

entities=$(sort -u "$QUEUE" | tr '\n' ' ')
[[ -n "${entities// /}" ]] || { rm -f "$QUEUE"; exit 0; }

rm -f "$QUEUE"

CLAUDE_BIN="$(command -v claude || true)"
[[ -n "$CLAUDE_BIN" ]] || exit 0

BRAIN="${BRAIN:-$HOME/Work/[00] Brain}"

"$CLAUDE_BIN" -p "Update these Brain entity indexes: $entities

For each entity listed:
1. Read the current index at $BRAIN/Indexes/{entity}.md
2. List all matching .md files at $BRAIN/ root
3. Add any files missing from the index
4. Remove any entries for files that no longer exist
5. Keep the existing format and structure of each index

Be surgical — only add/remove entries, don't rewrite the whole file." \
  --output-format json \
  --max-turns 10 \
  --allowedTools "Read,Glob,Grep,Write,Edit" \
  >> /tmp/brain-index-refresh.log 2>&1 &

exit 0
