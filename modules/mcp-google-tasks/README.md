# MCP Google Tasks Server

Local MCP server for Google Tasks API. Works with Claude Code via stdio transport.

## Setup

### 1. Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or use existing)
3. Enable the **Google Tasks API**: APIs & Services > Enable APIs > search "Tasks API" > Enable
4. Create OAuth credentials:
   - APIs & Services > Credentials > Create Credentials > OAuth Client ID
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:9876/oauth2callback`
   - Copy the **Client ID** and **Client Secret**

### 2. Install & Build

```bash
cd ~/Ship/mcp-google-tasks
npm install
npm run build
```

### 3. Authenticate

```bash
export GOOGLE_CLIENT_ID=your_client_id_here
export GOOGLE_CLIENT_SECRET=your_client_secret_here
npm run auth
```

This opens your browser for Google sign-in. Tokens are saved to `~/.config/mcp-google-tasks/tokens.json` and auto-refresh.

### 4. Configure Claude Code

Add this to `~/.claude/settings.json` under `mcpServers` (or `~/.claude/settings.local.json`):

```json
{
  "mcpServers": {
    "google-tasks": {
      "command": "node",
      "args": ["/path/to/JerryOS/modules/mcp-google-tasks/dist/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your_client_id_here",
        "GOOGLE_CLIENT_SECRET": "your_client_secret_here"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `list_tasklists` | List all task lists |
| `list_tasks` | List tasks (filter: open/completed/all, date range) |
| `create_task` | Create a task (title, notes, due date, subtasks) |
| `update_task` | Update a task (title, notes, due, status) |
| `complete_task` | Mark a task as completed |
| `delete_task` | Delete a task |
| `create_tasklist` | Create a new task list |

## Notes

- Due dates accept `YYYY-MM-DD` (auto-converted to RFC 3339) or full RFC 3339 timestamps
- Tokens auto-refresh; re-run `npm run auth` only if tokens are revoked
- Token file: `~/.config/mcp-google-tasks/tokens.json`
