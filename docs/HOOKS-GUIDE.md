# Hooks Guide

Hooks are shell scripts that run before or after Claude Code uses a tool. They're the safety layer between Claude's intent and actual execution.

## Hook Types

| Type | When it runs | Use case |
|------|-------------|----------|
| `PreToolUse` | Before a tool executes | Block dangerous commands, backup files |
| `PostToolUse` | After a tool executes | Validate output, log activity |
| `SessionStart` | When a Claude session begins | Initialize state |
| `SessionEnd` | When a Claude session ends | Cleanup, export |

## How Hooks Work

Hooks receive tool input via stdin as JSON:

```json
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf /"
  }
}
```

### Blocking a Tool Call (PreToolUse)

Exit code 2 + JSON on stdout = block the tool:

```bash
echo '{"decision":"block","reason":"Dangerous command blocked"}'
exit 2
```

Exit code 0 = allow the tool to proceed.

### Warning Without Blocking (PostToolUse)

Print a JSON warning on stdout (always exit 0):

```bash
echo '{"warning":"File is missing frontmatter"}'
exit 0
```

## JerryOS Hooks

### safety-gate.sh (PreToolUse → Bash)
Blocks ~100 dangerous command patterns including:
- File destruction (rm -rf, etc.)
- Git destructive ops (force push, hard reset)
- Data exfiltration (curl POST, scp, rsync)
- Crypto key access (seed phrases, wallet dirs)
- Self-modification (can't disable itself)

### backup-before-edit.sh (PreToolUse → Write|Edit)
Copies files to `~/.vault/file-backups/` before any edit.
Keeps last 200 versions per file.

### brain-guard.sh (PostToolUse → Write|Edit)
After any Brain vault write:
1. Validates frontmatter (type field, required fields)
2. Appends to Activity Log
3. Queues index refresh
4. Checks for duplicate files

## Writing Your Own Hook

```bash
#!/usr/bin/env bash
set -euo pipefail

# Read the tool input
input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // ""')
file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""')

# Your logic here
if [[ "$file_path" == *"sensitive"* ]]; then
  echo '{"decision":"block","reason":"Cannot modify sensitive files"}'
  exit 2
fi

exit 0
```

## Registering Hooks

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/your-hook.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```
