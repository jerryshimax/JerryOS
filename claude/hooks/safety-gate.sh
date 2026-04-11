#!/usr/bin/env bash
set -euo pipefail

# safety-gate.sh — PreToolUse hook for Bash commands
# Blocks dangerous patterns before they execute.
# Exit 0 = allow, Exit 2 + JSON = block

cmd=$(jq -r '.tool_input.command // ""' < /dev/stdin)

# ── Safe-path allowlist (checked BEFORE deny patterns) ──
# Allow rm of common temp files in Downloads only (no recursive)
if echo "$cmd" | grep -Eq 'rm\s+(-f\s+)?~/Downloads/.*\.(dmg|pkg|zip|tmp|json|xml|jpg|png|gif)' && \
   ! echo "$cmd" | grep -Eq 'rm\s+-r'; then
  exit 0
fi

# Block list
deny_patterns=(
  # -- Destructive file operations --
  'rm\s+-rf'
  'rm\s+-r\s'
  'rm\s+--recursive'
  '\brm\b.*\s+/'
  'mv\s+/'
  'mv\s+~/'
  'mv\s+~\s'

  # -- Git destructive --
  'git\s+push\s+(-f|--force)'
  'git\s+reset\s+--hard'

  # -- System commands --
  'sudo\s+'
  'chmod\s+777'
  'mkfs\.'
  'dd\s+if='

  # -- Pipe-to-shell (remote code execution) --
  'curl.*\|\s*bash'
  'curl.*\|\s*sh'
  'wget.*\|\s*bash'
  ':()\{\s*:\|:&'
  'DROP\s+TABLE'

  # -- Exfiltration: block outbound data sends --
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

  # -- Transaction: must prompt before these --
  'git\s+push'
  'git\s+clone'
  'pip\s+install'
  'pip3\s+install'
  'brew\s+install'
  'brew\s+uninstall'
  'brew\s+remove'
  'npm\s+install\s+-g'
  'npm\s+publish'
  'launchctl\s+unload'
  'launchctl\s+remove'

  # -- Indirect delete/overwrite --
  'xargs\s+rm'
  'xargs\s.*\brm\b'
  '\bfind\b.*-delete'
  '\bfind\b.*-exec\s+rm'

  # -- File truncation/overwrite via redirect --
  '>\s*~/\.'
  '>\s*~/.ssh/'
  '>\s*~/.aws/'
  '>\s*~/.gnupg/'
  '>\s*~/.claude/'
  '>\s*~/Library/LaunchAgents/'
  '\btee\s+~/\.'
  '\btee\s+~/.claude/'
  '\btee\s+~/Library/LaunchAgents/'

  # -- Self-protection: don't let Claude disable its own safety --
  '>\s*.*safety-gate'
  'cat\s.*>\s*.*safety-gate'
  '\brm\b.*safety-gate'

  # -- Vault isolation: Claude cannot touch the isolated backup --
  '/\.vault/'
  'vault/brain'
  'vault/file-backups'

  # -- Protect sensitive dotfiles --
  '>\s*~/.zshrc'
  '>\s*~/.bashrc'
  '>\s*~/.bash_profile'
  '>\s*~/.zprofile'
  '>\s*~/.gitconfig'
  '\btee\s+~/.zshrc'
  '\btee\s+~/.bashrc'
  '\btee\s+~/.gitconfig'

  # -- Block open launching arbitrary apps --
  'open\s+-a\s'

  # ── Crypto security: seed phrases, private keys, wallet dirs ──
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
