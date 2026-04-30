#!/usr/bin/env bash
# safety-gate.sh — PreToolUse Bash hook
# Blocks destructive shell commands before they execute.
# Decision: exit 2 with a JSON block reason; exit 0 otherwise.

set -euo pipefail

INPUT=$(cat /dev/stdin)
if command -v jq &>/dev/null; then
  cmd=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
else
  cmd=$(echo "$INPUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))')
fi

# ── Safe-path allowlist (checked BEFORE deny patterns) ──
# Allow common Downloads / cloud-storage move + cleanup patterns.
if echo "$cmd" | grep -Eq 'mv\s+~/Downloads/.*~/Work/'; then
  exit 0
fi
if echo "$cmd" | grep -Eq 'rm\s+(-f\s+)?~/Downloads/.*\.(dmg|pkg|zip|tmp|json|xml|jpg|png|gif)' && \
   ! echo "$cmd" | grep -Eq 'rm\s+-r'; then
  exit 0
fi
if echo "$cmd" | grep -Eq 'rm\s+-rf\s+~/Downloads/"?Telegram Desktop"?' && \
   ! echo "$cmd" | grep -Eq '/\.\.'; then
  exit 0
fi

deny_patterns=(
  # ── Destructive file operations ──
  'rm\s+-rf'
  'rm\s+-r\s'
  'rm\s+--recursive'
  '\brm\b.*\s+/'
  'mv\s+/'
  'mv\s+~/'
  'mv\s+~\s'

  # ── Git destructive ──
  'git\s+push\s+(-f|--force)'
  'git\s+reset\s+--hard'

  # ── System commands ──
  'sudo\s+'
  'chmod\s+777'
  'mkfs\.'
  'dd\s+if='

  # ── Pipe-to-shell (RCE) ──
  'curl.*\|\s*bash'
  'curl.*\|\s*sh'
  'wget.*\|\s*bash'
  ':()\{\s*:\|:&'
  'DROP\s+TABLE'

  # ── Exfiltration ──
  'curl\s+.*-X\s*(POST|PUT|DELETE)'
  'curl\s+.*--data'
  'curl\s+.*-d\s'
  'curl\s+.*-F\s'
  'curl\s+.*--upload'
  'curl\s+-o\s'
  'curl\s+--output\s'
  'wget\s+.*--post'
  '\bscp\s+'
  '\brsync\s+'
  '\bsftp\s+'
  '\bnc\s+'
  '\bncat\s+'

  # ── Transactional installs / launchd surgery (require manual approval) ──
  'pip\s+install'
  'pip3\s+install'
  'brew\s+install'
  'brew\s+uninstall'
  'brew\s+remove'
  'npm\s+install\s+-g'
  'npm\s+publish'
  'launchctl\s+unload'
  'launchctl\s+remove'

  # ── Indirect delete ──
  'xargs\s+rm'
  'xargs\s.*\brm\b'
  '\bfind\b.*-delete'
  '\bfind\b.*-exec\s+rm'

  # ── File truncation via redirect ──
  '>\s*~/\.'
  '>\s*~/.ssh/'
  '>\s*~/.aws/'
  '>\s*~/.gnupg/'
  '>\s*~/.claude/'
  '>\s*~/Library/LaunchAgents/'
  '\btee\s+~/\.'
  '\btee\s+~/.claude/'
  '\btee\s+~/Library/LaunchAgents/'

  # ── Self-protection ──
  '>\s*.*safety-gate'
  'cat\s.*>\s*.*safety-gate'
  '\brm\b.*safety-gate'

  # ── Vault isolation ──
  '/\.vault/'
  'vault/brain'
  'vault/claude-infra'
  'vault/file-backups'
  'vault/mirror'

  # ── Dotfile protection ──
  '>\s*~/.zshrc'
  '>\s*~/.bashrc'
  '>\s*~/.bash_profile'
  '>\s*~/.zprofile'
  '>\s*~/.gitconfig'
  '\btee\s+~/.zshrc'
  '\btee\s+~/.bashrc'
  '\btee\s+~/.gitconfig'

  # ── Block launching arbitrary apps ──
  'open\s+-a\s'

  # ── Crypto: seed phrases, private keys, wallet dirs ──
  'seed.phrase'
  'mnemonic'
  'private.key'
  'secret.key'
  'keystore'
  '\.key\b'
  'wallet.*export'
  'wallet.*backup'
  'seed.*word'
  'recovery.*phrase'
  '0x[a-fA-F0-9]{64}'
  '\.solana/'
  '\.ethereum/'
  '\.bitcoin/'
  '\.config/solana'
  '\.gnosis'
  'keystore/'
  '\.keys/'
)

for pat in "${deny_patterns[@]}"; do
  if echo "$cmd" | grep -Eiq "$pat"; then
    echo '{"decision":"block","reason":"Blocked by safety hook: matches pattern '"'$pat'"'"}'
    exit 2
  fi
done

exit 0
