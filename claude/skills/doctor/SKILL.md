---
name: doctor
description: "Health-check all integrations, MCPs, bots, tools, hooks, LaunchAgents, and cron jobs. Traffic-light dashboard."
user_invocable: true
---

# Doctor — System Health Check

Run the doctor script to health-check the user's full Claude Code setup.

## Instructions

1. Run the doctor script:

```bash
bash ~/Ship/tools/doctor.sh
```

2. Parse the output and present the results. Group by section.

3. For any failures (red) or warnings (yellow), suggest a specific fix:

| Issue | Likely Fix |
|-------|-----------|
| MCP binary missing | `cd ~/Ship/mcp-{name} && npm run build` |
| MCP server not responding | Check env vars in `~/.claude.json`, rebuild with `npm run build` |
| Telegram bot token invalid | Check `~/.claude/channels/telegram/.env`, regenerate via @BotFather |
| Hook not executable | `chmod +x ~/.claude/hooks/{name}.sh` |
| LaunchAgent not loaded | `launchctl load ~/Library/LaunchAgents/{plist}` |
| LaunchAgent exit non-zero | Check logs: `cat ~/Ship/logs/{service}.log` or `log show --predicate 'eventMessage contains "{service}"' --last 1h` |
| CLI tool missing | `brew install {tool}` |
| gh auth failed | `gh auth login` |
| Google Drive not syncing | Open Google Drive app, check sync status |
| Disk space low | Clean `~/Ship/logs/`, `~/.claude/backups/`, or old downloads |
| Config invalid JSON | Check file with `jq . {path}` and fix syntax |
| cc-costline missing | Check if it is in `~/Ship/tools/` or installed globally |
| Skills manifest missing | Run `cd ~/.claude/skills && shasum -a 256 */SKILL.md > MANIFEST.sha256` |

4. End with the summary line from the script output.

5. If the user asks to fix something, apply the fix directly when safe (rebuild MCP, load LaunchAgent, etc.). For destructive fixes, confirm first.
