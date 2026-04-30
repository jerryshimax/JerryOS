#!/usr/bin/env bash
set -euo pipefail

# ══════════════════════════════════════════════════════════
# JerryOS v2 Setup
# Installs the Claude Code OS layer: skills, hooks, agents,
# rules, and Brain vault scaffolding.
# Daemons (cloud-bot, mcp-memory, etc.) are pointer-docs only —
# clone those repos separately if you want them.
# ══════════════════════════════════════════════════════════

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

pass()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail()   { echo -e "  ${RED}✗${NC} $1"; }
warn()   { echo -e "  ${YELLOW}!${NC} $1"; }
info()   { echo -e "  ${BLUE}→${NC} $1"; }
header() { echo -e "\n${BOLD}$1${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_FILE="$SCRIPT_DIR/jerryos.conf"

echo -e "${BOLD}JerryOS v2 Setup${NC}"
echo "================"

# ─── Step 0: Config ─────────────────────────────────────
if [[ ! -f "$CONF_FILE" ]]; then
  echo ""
  fail "Config file not found: jerryos.conf"
  echo ""
  echo "  Copy the example and edit it:"
  echo "    cp jerryos.conf.example jerryos.conf"
  echo "    \$EDITOR jerryos.conf"
  echo ""
  echo "  Then run: ./setup.sh"
  exit 1
fi

# shellcheck disable=SC1090
source "$CONF_FILE"

# ─── Step 1: Prereqs ────────────────────────────────────
header "Step 1: Checking prerequisites"

prereqs_ok=true
check() {
  local name="$1" cmd="$2" hint="$3"
  if command -v "$cmd" &>/dev/null; then
    pass "$name"
  else
    fail "$name not found"
    [[ -n "$hint" ]] && info "$hint"
    prereqs_ok=false
  fi
}

check "Claude Code CLI" claude "Install: npm i -g @anthropic-ai/claude-code"
check "jq"              jq     "brew install jq"
check "Node.js"         node   "brew install node"
check "Python 3"        python3 "brew install python"
check "Git"             git    "brew install git"

if [[ "$prereqs_ok" == "false" ]]; then
  echo ""
  fail "Missing prerequisites. Install them, then re-run setup."
  exit 1
fi

# ─── Step 2: Render CLAUDE.md ───────────────────────────
header "Step 2: Generating CLAUDE.md"

ENTITY_FOLDERS=""
ENTITY_TAGS_TABLE="| Tag | Entity | Scope |\n|-----|--------|-------|\n"
ENTITY_TAGS_LIST=""
for entity_str in "${ENTITIES[@]}"; do
  IFS=':' read -r tag name desc <<< "$entity_str"
  ENTITY_FOLDERS="${ENTITY_FOLDERS}├── $name/\n│   ├── Deals/\n│   ├── Research/\n│   ├── Meetings/\n│   ├── Legal/\n│   └── Decks/\n"
  ENTITY_TAGS_TABLE="${ENTITY_TAGS_TABLE}| \`$tag\` | $name | $desc |\n"
  ENTITY_TAGS_LIST="${ENTITY_TAGS_LIST}$tag "
done

CLAUDE_MD="$HOME/CLAUDE.md"
if [[ -f "$CLAUDE_MD" ]]; then
  warn "CLAUDE.md exists — backing up to CLAUDE.md.backup.$(date +%s)"
  cp "$CLAUDE_MD" "${CLAUDE_MD}.backup.$(date +%s)"
fi

sed \
  -e "s|{{USER_NAME}}|$USER_NAME|g" \
  -e "s|{{USER_ROLE}}|$USER_ROLE|g" \
  -e "s|{{USER_BIO}}|$USER_BIO|g" \
  -e "s|{{WORK_PATH}}|$WORK_PATH|g" \
  -e "s|{{BRAIN_PATH}}|$BRAIN_PATH|g" \
  "$SCRIPT_DIR/claude/CLAUDE.md.template" > "$CLAUDE_MD.tmp"

python3 - <<PY
content = open("$CLAUDE_MD.tmp").read()
content = content.replace("{{ENTITY_FOLDERS}}", """$(echo -e "$ENTITY_FOLDERS")""")
content = content.replace("{{ENTITY_TAGS_TABLE}}", """$(echo -e "$ENTITY_TAGS_TABLE")""")
open("$CLAUDE_MD", "w").write(content)
PY
rm -f "$CLAUDE_MD.tmp"
pass "CLAUDE.md generated at $CLAUDE_MD"

# ─── Step 3: Hooks (symlink) ────────────────────────────
header "Step 3: Installing hooks"

mkdir -p "$HOME/.claude/hooks"
hook_count=0
for hook_path in "$SCRIPT_DIR"/claude/hooks/*.sh; do
  [[ -f "$hook_path" ]] || continue
  hook_name=$(basename "$hook_path")
  dst="$HOME/.claude/hooks/$hook_name"
  if [[ -e "$dst" && ! -L "$dst" ]]; then
    cp "$dst" "${dst}.backup.$(date +%s)"
    warn "$hook_name existed — backed up before relinking"
    rm -f "$dst"
  fi
  ln -sfn "$hook_path" "$dst"
  chmod +x "$hook_path"
  hook_count=$((hook_count + 1))
done

# Symlink the lib/ helper directory too
if [[ -d "$SCRIPT_DIR/claude/hooks/lib" ]]; then
  ln -sfn "$SCRIPT_DIR/claude/hooks/lib" "$HOME/.claude/hooks/lib"
fi
pass "$hook_count hooks linked"

# Stub config files (user fills these in if needed)
[[ -f "$HOME/.claude/.entities" ]] || printf "%s\n" $ENTITY_TAGS_LIST | tr ' ' '\n' | sed '/^$/d' > "$HOME/.claude/.entities"
if [[ ! -f "$HOME/.claude/.chat-rules.json" ]]; then
  cat > "$HOME/.claude/.chat-rules.json" <<'EOF'
{
  "default": {"deny": [".vault", ".ssh", ".aws", ".gnupg"]}
}
EOF
fi
pass "Hook config stubs written (~/.claude/.entities, ~/.claude/.chat-rules.json)"

# ─── Step 4: Skills (symlink) ───────────────────────────
header "Step 4: Installing skills"

mkdir -p "$HOME/.claude/skills"
skill_count=0
for skill_dir in "$SCRIPT_DIR"/claude/skills/*/; do
  [[ -d "$skill_dir" ]] || continue
  skill_name=$(basename "$skill_dir")
  [[ "$skill_name" == ".claude" ]] && continue
  [[ -f "$skill_dir/SKILL.md" ]] || continue
  dst="$HOME/.claude/skills/$skill_name"
  if [[ -e "$dst" && ! -L "$dst" ]]; then
    cp -r "$dst" "${dst}.backup.$(date +%s)"
    rm -rf "$dst"
  fi
  ln -sfn "$skill_dir%/" "$dst" 2>/dev/null || ln -sfn "${skill_dir%/}" "$dst"
  skill_count=$((skill_count + 1))
done
pass "$skill_count skills linked"

# ─── Step 5: Rules (render templates) ───────────────────
header "Step 5: Rendering autoload rules"

mkdir -p "$HOME/.claude/rules"
rule_count=0
for rule_path in "$SCRIPT_DIR"/claude/rules/*.md; do
  [[ -f "$rule_path" ]] || continue
  rule_name=$(basename "$rule_path")
  dst="$HOME/.claude/rules/$rule_name"

  # Substitute first three entity tags as ENTITY_A/B/C placeholders.
  ent_a=$(echo "${ENTITIES[0]:-}" | cut -d: -f1)
  ent_b=$(echo "${ENTITIES[1]:-}" | cut -d: -f1)
  ent_c=$(echo "${ENTITIES[2]:-}" | cut -d: -f1)
  ent_a_name=$(echo "${ENTITIES[0]:-}" | cut -d: -f2)
  ent_b_name=$(echo "${ENTITIES[1]:-}" | cut -d: -f2)
  ent_c_name=$(echo "${ENTITIES[2]:-}" | cut -d: -f2)

  sed \
    -e "s|ENTITY_A_NAME|${ent_a_name:-Entity One}|g" \
    -e "s|ENTITY_B_NAME|${ent_b_name:-Entity Two}|g" \
    -e "s|ENTITY_C_NAME|${ent_c_name:-Entity Three}|g" \
    -e "s|ENTITY_A|${ent_a:-ENT1}|g" \
    -e "s|ENTITY_B|${ent_b:-ENT2}|g" \
    -e "s|ENTITY_C|${ent_c:-ENT3}|g" \
    -e "s|{{WORK_PATH}}|$WORK_PATH|g" \
    -e "s|{{BRAIN_PATH}}|$BRAIN_PATH|g" \
    "$rule_path" > "$dst"
  rule_count=$((rule_count + 1))
done
pass "$rule_count rules rendered"

# ─── Step 6: Agents (scaffold) ──────────────────────────
header "Step 6: Scaffolding agents"

mkdir -p "$HOME/.claude/agents"
agent_count=0
for agent_name in "${AGENTS[@]:-}"; do
  src="$SCRIPT_DIR/claude/agents/examples/$agent_name"
  if [[ ! -d "$src" ]]; then
    warn "Agent template not found: $agent_name"
    continue
  fi
  dst="$HOME/.claude/agents/$agent_name"
  if [[ -e "$dst" ]]; then
    warn "Agent $agent_name already exists — skipping"
    continue
  fi
  mkdir -p "$dst"
  for f in AGENT.md SOUL.md AGENTS.md MEMORY.md; do
    [[ -f "$src/$f" ]] && cp "$src/$f" "$dst/$f"
  done
  agent_count=$((agent_count + 1))
  pass "$agent_name"
done

# Common agent tooling
if [[ -f "$SCRIPT_DIR/claude/agents/render-prompt.sh" ]]; then
  ln -sfn "$SCRIPT_DIR/claude/agents/render-prompt.sh" "$HOME/.claude/agents/render-prompt.sh"
fi
pass "$agent_count agents scaffolded"

# ─── Step 7: Brain vault ────────────────────────────────
header "Step 7: Setting up Brain vault"

mkdir -p "$BRAIN_PATH/Templates" "$BRAIN_PATH/Indexes" "$BRAIN_PATH/.obsidian"

template_count=0
for tmpl in "$SCRIPT_DIR"/brain/Templates/*.md; do
  [[ -f "$tmpl" ]] || continue
  cp -n "$tmpl" "$BRAIN_PATH/Templates/" || true
  template_count=$((template_count + 1))
done
pass "$template_count templates installed"

[[ -f "$SCRIPT_DIR/brain/Dashboard.md" ]] && cp -n "$SCRIPT_DIR/brain/Dashboard.md" "$BRAIN_PATH/Dashboard.md" && pass "Dashboard.md"
[[ -f "$SCRIPT_DIR/brain/Activity Log.md" ]] && cp -n "$SCRIPT_DIR/brain/Activity Log.md" "$BRAIN_PATH/Activity Log.md" && pass "Activity Log.md"

for entity_str in "${ENTITIES[@]}"; do
  IFS=':' read -r tag name desc <<< "$entity_str"
  index_file="$BRAIN_PATH/Indexes/$tag.md"
  if [[ ! -f "$index_file" ]]; then
    cat > "$index_file" <<EOF
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

# ─── Step 8: Settings ───────────────────────────────────
header "Step 8: Claude Code settings"

SETTINGS_FILE="$HOME/.claude/settings.json"
if [[ -f "$SETTINGS_FILE" ]]; then
  warn "settings.json already exists — leaving it alone"
  info "Reference template: $SCRIPT_DIR/claude/settings.json.template"
else
  sed "s|__HOME__|$HOME|g" "$SCRIPT_DIR/claude/settings.json.template" > "$SETTINGS_FILE"
  pass "settings.json installed"
fi

# ─── Step 9: Backup vault ───────────────────────────────
header "Step 9: Safety vault"
mkdir -p "$HOME/.vault/file-backups"
pass "Backup vault at ~/.vault/file-backups/"

# ─── Step 10: MCP snippets ──────────────────────────────
header "Step 10: MCP server snippets"

if [[ "${#MCPS[@]:-0}" -eq 0 ]]; then
  info "No MCPs requested in jerryos.conf — skipping"
else
  echo ""
  info "Add the snippets below to ~/.claude.json under"
  info "\"projects.\$HOME.mcpServers\". JerryOS never writes secrets for you."
  echo ""
  for mcp in "${MCPS[@]}"; do
    case "$mcp" in
      memory)
        cat <<'EOF'
"memory": {
  "command": "node",
  "args": ["/PATH/TO/mcp-memory/dist/index.js"]
}
EOF
        ;;
      google-tasks)
        cat <<'EOF'
"google-tasks": {
  "command": "node",
  "args": ["/PATH/TO/mcp-google-tasks/dist/index.js"],
  "env": {"GOOGLE_CLIENT_ID": "YOUR_ID", "GOOGLE_CLIENT_SECRET": "YOUR_SECRET"}
}
EOF
        ;;
      superhuman|gmail|gcal|gdrive)
        echo "# $mcp — install via Claude Code Connectors UI"
        ;;
      context7)
        cat <<'EOF'
"context7": {
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp"]
}
EOF
        ;;
      playwright)
        cat <<'EOF'
"playwright": {
  "command": "npx",
  "args": ["-y", "@playwright/mcp@latest"]
}
EOF
        ;;
      *)
        warn "Unknown MCP: $mcp"
        ;;
    esac
    echo ""
  done
fi

# ─── Done ───────────────────────────────────────────────
header "Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Open Obsidian → 'Open folder as vault' → $BRAIN_PATH"
echo "  2. Paste any MCP snippets above into ~/.claude.json"
echo "  3. Run 'claude' to start a session"
echo ""

if [[ "${ENABLE_CLOUD_BOT:-false}" == "true" ]]; then
  echo "  Cloud Bot — clone separately:"
  echo "    git clone https://github.com/jerryshimax/cloud-bot.git ~/Ship/cloud-bot"
  echo ""
fi
if [[ "${ENABLE_DOWNLOADS_FILER:-false}" == "true" ]]; then
  echo "  Downloads Filer:"
  echo "    git clone https://github.com/jerryshimax/downloads-filer.git ~/Ship/downloads-filer"
  echo ""
fi
if [[ "${ENABLE_MAC_BOOTSTRAP:-false}" == "true" ]]; then
  echo "  Mac Bootstrap:"
  echo "    git clone https://github.com/jerryshimax/mac-bootstrap.git ~/Ship/mac-bootstrap"
  echo ""
fi
