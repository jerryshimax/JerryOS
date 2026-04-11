# Utility Scripts

## log-rotate.sh

Truncates log files over 5MB. Designed to run daily.

Usage:
```bash
./log-rotate.sh
```

Set `SHIP_PATH` env var to customize the log directory.

## doctor.sh

Health check for all JerryOS components. Checks:
- Claude Code CLI installation
- Hook installation and permissions
- Brain vault structure
- Backup vault existence
- MCP server build status
- Skill count

Usage:
```bash
./doctor.sh
```
