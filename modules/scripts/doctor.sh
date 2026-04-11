#!/usr/bin/env bash
# doctor.sh — Health check for JerryOS components
# Run: ./doctor.sh or invoke via /doctor skill

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }

echo "=== JerryOS Health Check ==="
echo ""

# Claude Code
if command -v claude &>/dev/null; then
  pass "Claude Code CLI installed"
else
  fail "Claude Code CLI not found (npm install -g @anthropic-ai/claude-code)"
fi

# Hooks
echo ""
echo "--- Hooks ---"
for hook in safety-gate.sh backup-before-edit.sh brain-guard.sh; do
  if [[ -f "$HOME/.claude/hooks/$hook" ]]; then
    if [[ -x "$HOME/.claude/hooks/$hook" ]]; then
      pass "$hook (installed, executable)"
    else
      warn "$hook (installed, NOT executable — run: chmod +x ~/.claude/hooks/$hook)"
    fi
  else
    fail "$hook not installed"
  fi
done

# Brain vault
echo ""
echo "--- Brain Vault ---"
BRAIN="${BRAIN_PATH:-$HOME/Brain}"
if [[ -d "$BRAIN" ]]; then
  pass "Vault exists at $BRAIN"
  [[ -d "$BRAIN/Templates" ]] && pass "Templates/ present" || warn "Templates/ missing"
  [[ -d "$BRAIN/Indexes" ]] && pass "Indexes/ present" || warn "Indexes/ missing"
  [[ -f "$BRAIN/Dashboard.md" ]] && pass "Dashboard.md present" || warn "Dashboard.md missing"
  [[ -f "$BRAIN/Activity Log.md" ]] && pass "Activity Log.md present" || warn "Activity Log.md missing"
else
  fail "Vault not found at $BRAIN"
fi

# Backup vault
echo ""
echo "--- Safety ---"
if [[ -d "$HOME/.vault" ]]; then
  pass "Backup vault exists at ~/.vault/"
else
  warn "Backup vault not found (will be created on first edit)"
fi

# MCP servers
echo ""
echo "--- MCP Servers ---"
for mcp in mcp-memory mcp-google-tasks; do
  mcp_path="${SHIP_PATH:-$HOME/Ship}/$mcp"
  if [[ -d "$mcp_path" ]]; then
    if [[ -f "$mcp_path/dist/index.js" ]]; then
      pass "$mcp (built)"
    else
      warn "$mcp (exists but not built — run: cd $mcp_path && npm run build)"
    fi
  else
    echo "  - $mcp: not installed"
  fi
done

# Skills
echo ""
echo "--- Skills ---"
skill_count=$(ls -d "$HOME/.claude/skills/"*/ 2>/dev/null | wc -l | tr -d ' ')
echo "  $skill_count skills installed"

echo ""
echo "=== Done ==="
