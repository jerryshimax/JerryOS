#!/usr/bin/env bash
set -euo pipefail

# ══════════════════════════════════════════════════════════
# JerryOS v1 → v2 Upgrade
# Backs up the existing ~/.claude install, then layers in
# the v2 additions: 9 hooks (was 3), rules dir, agents dir,
# expanded skill set. Preserves your CLAUDE.md and memory.
# ══════════════════════════════════════════════════════════

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

pass()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail()   { echo -e "  ${RED}✗${NC} $1"; }
warn()   { echo -e "  ${YELLOW}!${NC} $1"; }
info()   { echo -e "  ${BLUE}→${NC} $1"; }
header() { echo -e "\n${BOLD}$1${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS=$(date +%s)
BACKUP="$HOME/.claude.v1.bak.$TS"

echo -e "${BOLD}JerryOS v1 → v2 upgrade${NC}"
echo "======================="

# ─── Step 1: Sanity ─────────────────────────────────────
if [[ ! -d "$HOME/.claude" ]]; then
  fail "No existing ~/.claude directory found — nothing to upgrade."
  info "Run ./setup.sh instead for a fresh install."
  exit 1
fi

if [[ ! -f "$SCRIPT_DIR/jerryos.conf" ]]; then
  fail "jerryos.conf not found"
  info "cp jerryos.conf.example jerryos.conf  &&  edit it"
  exit 1
fi

# ─── Step 2: Backup ─────────────────────────────────────
header "Step 1: Backing up existing ~/.claude"
cp -R "$HOME/.claude" "$BACKUP"
pass "Backup at $BACKUP"

# Detect v1 markers (presence of v1-only files)
v1_detected=false
[[ -f "$HOME/.claude/hooks/safety-gate.sh" && ! -d "$HOME/.claude/rules" ]] && v1_detected=true
if $v1_detected; then
  info "v1 install detected (hooks present, no rules/ dir)"
else
  info "Layered install — preserving your existing setup"
fi

# ─── Step 3: Preserve user data ─────────────────────────
header "Step 2: Preserving user data"
# CLAUDE.md, memory/, plans/, projects/, .agents/ all stay untouched.
[[ -f "$HOME/CLAUDE.md" ]]               && pass "~/CLAUDE.md preserved"
[[ -d "$HOME/.claude/memory" ]]          && pass "~/.claude/memory/ preserved"
[[ -d "$HOME/.claude/plans" ]]           && pass "~/.claude/plans/ preserved"
[[ -d "$HOME/.claude/projects" ]]        && pass "~/.claude/projects/ preserved"
[[ -d "$HOME/.claude/agents" ]]          && pass "~/.claude/agents/ preserved (review for v2 templates after)"

# ─── Step 4: Layer in v2 ────────────────────────────────
header "Step 3: Running v2 setup (idempotent)"
"$SCRIPT_DIR/setup.sh"

# ─── Step 5: Diff summary ───────────────────────────────
header "Step 4: Diff summary"

echo ""
info "What changed:"
diff_count=0
for path in hooks rules skills agents; do
  before="$BACKUP/$path"
  after="$HOME/.claude/$path"
  if [[ -d "$before" && -d "$after" ]]; then
    added=$(comm -13 <(ls "$before" 2>/dev/null | sort) <(ls "$after" 2>/dev/null | sort) | wc -l | tr -d ' ')
    removed=$(comm -23 <(ls "$before" 2>/dev/null | sort) <(ls "$after" 2>/dev/null | sort) | wc -l | tr -d ' ')
    echo "    $path:  +$added  -$removed"
    diff_count=$((diff_count + added + removed))
  elif [[ -d "$after" ]]; then
    new_count=$(ls "$after" 2>/dev/null | wc -l | tr -d ' ')
    echo "    $path:  NEW dir, $new_count entries"
    diff_count=$((diff_count + new_count))
  fi
done

echo ""
if [[ $diff_count -eq 0 ]]; then
  warn "No structural changes — already on v2?"
else
  pass "Upgrade complete. $diff_count files added/removed."
fi

echo ""
echo "  Rollback if needed:"
echo "    rm -rf ~/.claude && mv $BACKUP ~/.claude"
echo ""
echo "  Review:"
echo "    diff -r $BACKUP ~/.claude | less"
echo ""
