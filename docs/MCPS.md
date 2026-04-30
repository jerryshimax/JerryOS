# MCP Server Wiring

MCP (Model Context Protocol) servers extend Claude Code with external tools. JerryOS lists which MCPs to wire in `jerryos.conf` `MCPS=`, and `setup.sh` prints the JSON snippets — **you paste them into `~/.claude.json` yourself**. Setup never writes secrets.

## Where MCPs go

```jsonc
// ~/.claude.json
{
  "projects": {
    "/Users/<you>": {
      "mcpServers": {
        // paste snippets here
      }
    }
  }
}
```

Restart Claude Code after editing.

## Bundled snippets

### memory (jerryshimax/mcp-memory)
Local BM25 search over Brain + memory + handoffs.

```jsonc
"memory": {
  "command": "node",
  "args": ["/PATH/TO/mcp-memory/dist/index.js"]
}
```

Build first: `cd ~/Ship/mcp-memory && npm install && npm run build`.

### google-tasks (jerryshimax/mcp-google-tasks)
Custom Google Tasks MCP — 9 tools (create, complete, search, etc.).

```jsonc
"google-tasks": {
  "command": "node",
  "args": ["/PATH/TO/mcp-google-tasks/dist/index.js"],
  "env": {
    "GOOGLE_CLIENT_ID": "YOUR_ID",
    "GOOGLE_CLIENT_SECRET": "YOUR_SECRET"
  }
}
```

OAuth setup is per-user. See repo README.

### context7 (Upstash — library docs)
```jsonc
"context7": {
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp"]
}
```

### playwright (Microsoft — browser automation)
```jsonc
"playwright": {
  "command": "npx",
  "args": ["-y", "@playwright/mcp@latest"]
}
```

### Anthropic Connectors (superhuman / gmail / gcal / gdrive)
These install via the Claude Code Connectors UI (`/connect`). No JSON snippet needed.

## Secret hygiene

- **Never** put secrets in `settings.json` or `settings.local.json`. They live in `~/.claude.json` only.
- **Never** commit `~/.claude.json` to git.
- **Never** paste OAuth tokens or API keys into the JerryOS repo. The `.gitignore` has belt-and-suspenders for `.entities`, `.chat-rules.json`, and similar.
- Rotate any secret that leaks into a chat transcript. Hooks can't redact what already left.

## Adding a new MCP

1. Add the server name to `MCPS=` in `jerryos.conf`.
2. Add a case to `setup.sh` Step 10's switch (so the snippet prints next time).
3. Document the snippet here.
4. Run `./setup.sh` and paste the output into `~/.claude.json`.

## Debugging

If a server doesn't appear in `claude /mcp list`:

1. Check `~/.claude.json` JSON is valid: `jq . ~/.claude.json`.
2. Try the command standalone: `node /PATH/TO/dist/index.js`. Errors print to stderr.
3. Check Claude Code logs: `~/.claude/logs/`.
4. Verify `mcpServers` is under `projects.<your-home-path>` (not the top-level `mcpServers`).
