#!/usr/bin/env bash
set -euo pipefail

# ══════════════════════════════════════════════════════════
# JerryOS Setup Script
# An AI operating system for power users.
# ══════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

pass()  { echo -e "  ${GREEN}✓${NC} $1"; }
fail()  { echo -e "  ${RED}✗${NC} $1"; }
warn()  { echo -e "  ${YELLOW}!${NC} $1"; }
info()  { echo -e "  ${BLUE}→${NC} $1"; }
header() { echo -e "\n${BOLD}$1${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_FILE="$SCRIPT_DIR/jerry-os.conf"

# ─── Step 0: Check for config ───────────────────────────
echo -e "${BOLD}JerryOS Setup${NC}"
echo "============="

if [[ ! -f "$CONF_FILE" ]]; then
  echo ""
  fail "Config file not found: jerry-os.conf"
  echo ""
  echo "  Copy the example and fill in your details:"
  echo "    cp jerry-os.conf.example jerry-os.conf"
  echo "    open jerry-os.conf"
  echo ""
  echo "  Then run this script again."
  exit 1
fi

source "$CONF_FILE"

# ─── Step 1: Check prerequisites ────────────────────────
header "Step 1: Checking prerequisites"

prereqs_ok=true

if command -v claude &>/dev/null; then
  pass "Claude Code CLI"
else
  fail "Claude Code CLI not found"
  echo "    Install: npm install -g @anthropic-ai/claude-code"
  echo "    Then run 'claude' once to sign in."
  prereqs_ok=false
fi

if command -v jq &>/dev/null; then
  pass "jq"
else
  fail "jq not found (brew install jq)"
  prereqs_ok=false
fi

if command -v node &>/dev/null; then
  pass "Node.js ($(node -v))"
else
  fail "Node.js not found (brew install node)"
  prereqs_ok=false
fi

if command -v python3 &>/dev/null; then
  pass "Python 3"
else
  fail "Python 3 not found (brew install python3)"
  prereqs_ok=false
fi

if command -v git &>/dev/null; then
  pass "Git"
else
  fail "Git not found (brew install git)"
  prereqs_ok=false
fi

if [[ "$prereqs_ok" == "false" ]]; then
  echo ""
  fail "Missing prerequisites. Install them and run setup again."
  exit 1
fi

# ─── Step 2: Generate CLAUDE.md ─────────────────────────
header "Step 2: Generating CLAUDE.md"

# Build entity folders block
ENTITY_FOLDERS=""
ENTITY_TAGS_TABLE="| Tag | Entity | Scope |\n|-----|--------|-------|\n"
for entity_str in "${ENTITIES[@]}"; do
  IFS=':' read -r tag name desc <<< "$entity_str"
  ENTITY_FOLDERS="${ENTITY_FOLDERS}├── $name/\n│   ├── Deals/\n│   ├── Research/\n│   ├── Meetings/\n│   ├── Legal/\n│   └── Decks/\n"
  ENTITY_TAGS_TABLE="${ENTITY_TAGS_TABLE}| \`$tag\` | $name | $desc |\n"
done

# Generate CLAUDE.md from template
CLAUDE_MD="$HOME/CLAUDE.md"
if [[ -f "$CLAUDE_MD" ]]; then
  warn "CLAUDE.md already exists at $CLAUDE_MD — backing up to CLAUDE.md.backup"
  cp "$CLAUDE_MD" "${CLAUDE_MD}.backup"
fi

sed \
  -e "s|{{USER_NAME}}|$USER_NAME|g" \
  -e "s|{{USER_ROLE}}|$USER_ROLE|g" \
  -e "s|{{USER_BIO}}|$USER_BIO|g" \
  -e "s|{{WORK_PATH}}|$WORK_PATH|g" \
  -e "s|{{BRAIN_PATH}}|$BRAIN_PATH|g" \
  "$SCRIPT_DIR/claude/CLAUDE.md.template" > "$CLAUDE_MD.tmp"

# Replace multi-line blocks
python3 -c "
import sys
content = open('$CLAUDE_MD.tmp').read()
content = content.replace('{{ENTITY_FOLDERS}}', '''$(echo -e "$ENTITY_FOLDERS")''')
content = content.replace('{{ENTITY_TAGS_TABLE}}', '''$(echo -e "$ENTITY_TAGS_TABLE")''')
open('$CLAUDE_MD', 'w').write(content)
"
rm -f "$CLAUDE_MD.tmp"
pass "CLAUDE.md generated at $CLAUDE_MD"

# ─── Step 3: Install hooks ──────────────────────────────
header "Step 3: Installing safety hooks"

mkdir -p "$HOME/.claude/hooks"

for hook in safety-gate.sh backup-before-edit.sh brain-guard.sh; do
  src="$SCRIPT_DIR/claude/hooks/$hook"
  dst="$HOME/.claude/hooks/$hook"
  if [[ -f "$src" ]]; then
    cp "$src" "$dst"
    chmod +x "$dst"
    pass "$hook"
  else
    warn "$hook not found in repo"
  fi
done

# ─── Step 4: Install skills ─────────────────────────────
header "Step 4: Installing skills"

skill_count=0
for skill_dir in "$SCRIPT_DIR/claude/skills/"*/; do
  skill_name=$(basename "$skill_dir")
  if [[ -f "$skill_dir/SKILL.md" ]]; then
    mkdir -p "$HOME/.claude/skills/$skill_name"
    cp "$skill_dir/SKILL.md" "$HOME/.claude/skills/$skill_name/SKILL.md"
    skill_count=$((skill_count + 1))
  fi
done
pass "$skill_count skills installed"

# ─── Step 5: Create Brain vault ─────────────────────────
header "Step 5: Setting up Brain vault"

mkdir -p "$BRAIN_PATH/Templates" "$BRAIN_PATH/Indexes" "$BRAIN_PATH/.obsidian"

# Copy templates
template_count=0
for tmpl in "$SCRIPT_DIR/brain/Templates/"*.md; do
  if [[ -f "$tmpl" ]]; then
    cp "$tmpl" "$BRAIN_PATH/Templates/"
    template_count=$((template_count + 1))
  fi
done
pass "$template_count templates installed"

# Copy dashboard and activity log
if [[ -f "$SCRIPT_DIR/brain/Dashboard.md" ]]; then
  cp "$SCRIPT_DIR/brain/Dashboard.md" "$BRAIN_PATH/Dashboard.md"
  pass "Dashboard.md"
fi

if [[ -f "$SCRIPT_DIR/brain/Activity Log.md" ]]; then
  cp "$SCRIPT_DIR/brain/Activity Log.md" "$BRAIN_PATH/Activity Log.md"
  pass "Activity Log.md"
fi

# Create entity indexes
for entity_str in "${ENTITIES[@]}"; do
  IFS=':' read -r tag name desc <<< "$entity_str"
  index_file="$BRAIN_PATH/Indexes/$tag.md"
  if [[ ! -f "$index_file" ]]; then
    cat > "$index_file" << EOF
# $name Index

## Memos

## Meeting Notes

## Research

## Events

---
*Auto-maintained. Last updated: $(date +%Y-%m-%d)*
EOF
    pass "Index: $tag.md"
  fi
done

# ─── Step 6: Install settings ───────────────────────────
header "Step 6: Configuring Claude Code settings"

SETTINGS_FILE="$HOME/.claude/settings.json"
if [[ -f "$SETTINGS_FILE" ]]; then
  warn "settings.json already exists — not overwriting"
  info "Review $SCRIPT_DIR/claude/settings.json.template for recommended settings"
else
  sed "s|__HOME__|$HOME|g" "$SCRIPT_DIR/claude/settings.json.template" > "$SETTINGS_FILE"
  pass "settings.json installed"
fi

# ─── Step 7: Build modules ──────────────────────────────
header "Step 7: Setting up modules"

if [[ "${ENABLE_MCP_MEMORY:-false}" == "true" ]]; then
  mcp_dir="$SCRIPT_DIR/modules/mcp-memory"
  if [[ -f "$mcp_dir/package.json" ]]; then
    info "Building mcp-memory..."
    (cd "$mcp_dir" && npm install --silent && npm run build --silent 2>/dev/null) && \
      pass "mcp-memory built" || warn "mcp-memory build failed — check modules/mcp-memory/README.md"
  fi
fi

if [[ "${ENABLE_MCP_GOOGLE_TASKS:-false}" == "true" ]]; then
  mcp_dir="$SCRIPT_DIR/modules/mcp-google-tasks"
  if [[ -f "$mcp_dir/package.json" ]]; then
    info "Building mcp-google-tasks..."
    (cd "$mcp_dir" && npm install --silent && npm run build --silent 2>/dev/null) && \
      pass "mcp-google-tasks built" || warn "mcp-google-tasks build failed — check modules/mcp-google-tasks/README.md"
  fi
fi

if [[ "${ENABLE_ARENA:-false}" == "true" ]]; then
  arena_dir="$SCRIPT_DIR/modules/arena"
  if [[ -f "$arena_dir/requirements.txt" ]]; then
    info "Installing arena dependencies..."
    (cd "$arena_dir" && pip3 install -r requirements.txt --quiet 2>/dev/null) && \
      pass "arena dependencies installed" || warn "arena install failed — check modules/arena/README.md"
  fi
fi

if [[ "${ENABLE_CLOUD_BOT:-false}" == "true" ]]; then
  bot_dir="$SCRIPT_DIR/cloud-bot"
  if [[ -f "$bot_dir/package.json" ]]; then
    if command -v bun &>/dev/null; then
      info "Installing cloud-bot dependencies..."
      (cd "$bot_dir" && bun install --silent 2>/dev/null) && \
        pass "cloud-bot ready" || warn "cloud-bot install failed"
    else
      warn "cloud-bot requires Bun runtime (curl -fsSL https://bun.sh/install | bash)"
    fi
  fi
fi

# ─── Step 8: Generate settings.local.json ────────────────
header "Step 8: MCP server configuration"

LOCAL_SETTINGS="$HOME/.claude/settings.local.json"
if [[ -f "$LOCAL_SETTINGS" ]]; then
  warn "settings.local.json already exists — not overwriting"
  info "Add MCP servers manually from $SCRIPT_DIR/claude/settings.local.json.example"
else
  # Build MCP config dynamically based on enabled modules
  mcp_entries=""

  if [[ "${ENABLE_MCP_MEMORY:-false}" == "true" ]]; then
    mcp_entries="$mcp_entries\"memory\": {\"command\": \"node\", \"args\": [\"$SCRIPT_DIR/modules/mcp-memory/dist/index.js\"]},"
  fi

  if [[ "${ENABLE_MCP_GOOGLE_TASKS:-false}" == "true" ]]; then
    mcp_entries="$mcp_entries\"google-tasks\": {\"command\": \"node\", \"args\": [\"$SCRIPT_DIR/modules/mcp-google-tasks/dist/index.js\"], \"env\": {\"GOOGLE_CLIENT_ID\": \"YOUR_ID\", \"GOOGLE_CLIENT_SECRET\": \"YOUR_SECRET\"}},"
  fi

  # Remove trailing comma
  mcp_entries="${mcp_entries%,}"

  cat > "$LOCAL_SETTINGS" << EOJSON
{
  "permissions": {"allow": [], "deny": []},
  "mcpServers": {${mcp_entries}}
}
EOJSON
  pass "settings.local.json generated"
fi

# ─── Step 9: Create backup vault ────────────────────────
header "Step 9: Safety infrastructure"

mkdir -p "$HOME/.vault/file-backups"
pass "Backup vault created at ~/.vault/"

# ─── Done ────────────────────────────────────────────────
header "Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Open Obsidian → 'Open folder as vault' → $BRAIN_PATH"
echo "  2. Run 'claude' in your terminal to start using Claude Code"
echo "  3. Try: 'Create a [Research] Test Note.md' to test the vault"
echo ""

if [[ "${ENABLE_CLOUD_BOT:-false}" == "true" ]]; then
  echo "  Cloud Bot:"
  echo "  • Copy cloud-bot/.env.example to cloud-bot/.env"
  echo "  • Add your Telegram bot token"
  echo "  • Run: cd cloud-bot && bun run bot.ts"
  echo ""
fi

if [[ "${ENABLE_MCP_GOOGLE_TASKS:-false}" == "true" ]]; then
  echo "  Google Tasks:"
  echo "  • Update GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in ~/.claude/settings.local.json"
  echo "  • See modules/mcp-google-tasks/README.md for OAuth setup"
  echo ""
fi

echo "  Run the health check anytime:"
echo "    $SCRIPT_DIR/modules/scripts/doctor.sh"
echo ""
