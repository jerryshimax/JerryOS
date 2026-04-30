#!/usr/bin/env bash
# render-prompt.sh — compose an agent's full prompt from layered files.
#
# Layer order (long-stable prefixes first, for prompt-cache efficiency):
#   1. USER.md                       — who the user is
#   2. AGENTS.md                     — global rules every agent follows
#   3. <agent>/AGENT.md              — this agent's metadata
#   4. <agent>/SOUL.md               — this agent's identity / voice
#   5. <agent>/AGENTS.md             — per-agent overrides + extensions
#   6. <agent>/MEMORY.md             — agent-scoped notes (optional)
#
# Usage:
#   ./render-prompt.sh <agent-name>           # prints the composed prompt
#   ./render-prompt.sh <agent-name> "<msg>"   # appends user message and pipes to `claude -p`
#
set -euo pipefail

AGENTS_DIR="${AGENTS_DIR:-$HOME/.claude/agents}"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <agent-name> [message]" >&2
  exit 1
fi

AGENT="$1"
shift || true
AGENT_DIR="$AGENTS_DIR/$AGENT"

if [[ ! -d "$AGENT_DIR" ]]; then
  echo "✗ agent not found: $AGENT_DIR" >&2
  exit 1
fi

cat_if_exists() {
  [[ -f "$1" ]] && { cat "$1"; printf '\n\n---\n\n'; } || true
}

PROMPT=$(
  cat_if_exists "$AGENTS_DIR/USER.md"
  cat_if_exists "$AGENTS_DIR/AGENTS.md"
  cat_if_exists "$AGENT_DIR/AGENT.md"
  cat_if_exists "$AGENT_DIR/SOUL.md"
  cat_if_exists "$AGENT_DIR/AGENTS.md"
  cat_if_exists "$AGENT_DIR/MEMORY.md"
)

if [[ $# -eq 0 ]]; then
  printf '%s' "$PROMPT"
  exit 0
fi

USER_MSG="$*"

if ! command -v claude &>/dev/null; then
  echo "✗ claude CLI not found in PATH" >&2
  exit 1
fi

printf '%s\n\n# Message\n\n%s\n' "$PROMPT" "$USER_MSG" | claude -p
