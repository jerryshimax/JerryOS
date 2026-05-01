# Deployment Patterns

JerryOS runs anywhere `claude` does. This doc covers the deployment patterns Jerry uses in production. Most users want Pattern 1.

---

## Pattern 1 — Single laptop (default)

Run `./setup.sh` on your Mac. Claude Code uses your subscription auth. Hooks, skills, agents, rules load from `~/.claude/`. Brain in iCloud or Google Drive. Done.

Right starting point for everyone. Patterns below are for when you want agent continuity beyond your laptop's uptime.

---

## Pattern 2 — Always-on home server

If you run a slock daemon (`@slock-ai/daemon`) so agents reply to web/iPhone messages, and you want them reachable while you travel: host the daemon on a dedicated, always-on Mac. Keep your laptop as a thin client.

Naming below: **M2** = always-on Mac mini / desktop on home Ethernet. **M5** = laptop.

### Topology

```
slock.ai (cloud)
   ▲ websocket (machine API key)
   │
   M2 — always-on
       com.jerry.slock-daemon LaunchAgent
       ~/.slock/agents/{uuid}/MEMORY.md + notes/
       ~/Work/[00] Brain/  (GDrive replicated)
       ~/.claude/          (GitHub repo synced)
       ~/M5-Downloads/     (rsync from M5, 5-min)
   ▲ Tailscale SSH (rsync)
   │
   M5 — laptop
       Slock daemon DISABLED (plist .disabled-<date>)
       Slock.app PWA → slock.ai (frontend only)
   ▲ HTTPS
   │
   iPhone — Safari → slock.ai
```

### File access bridges

Agents on M2 need to read files. Three classes:

| Source | Mechanism | Lag |
|---|---|---|
| Brain (`~/Work/[00] Brain/`) | Cloud-replicated (GDrive/iCloud, same account both Macs) | 30–120s |
| `~/.claude/` (memory, hooks, skills) | Private GitHub repo, `com.jerry.claude-config-sync` LaunchAgent | 5 min |
| `~/Downloads/` | rsync over Tailscale SSH, M5→M2, every 5 min | 5 min |

### Two macOS gotchas

**1. `claude --version` ≠ authenticated.**

A daemon spawning `claude` subprocesses will hang silently if the binary's there but not logged in. `--version` checks binary presence only. To probe real auth:

```bash
echo "ping" | timeout 15 /opt/homebrew/bin/claude --print --model haiku
# Healthy: any LLM response.  Unauth: "Not logged in · Please run /login"
```

Run this in any preflight that gates daemon deployment. Note: SSH-spawned `claude` may report "not logged in" even when the GUI session is authenticated — credentials live in Keychain under `Claude Code-credentials` and the GUI launchd domain (`gui/$(id -u)`) reaches them, but a plain ssh session may not. The `gui/` domain is what matters for `launchctl bootstrap`.

**2. TCC blocks `~/Downloads/` writes via SSH.**

macOS protects `~/Downloads`, `~/Desktop`, `~/Documents` via TCC ("Files and Folders" privacy). Non-interactive ssh sessions can't write to these dirs even as the owner. Granting `/usr/sbin/sshd` Full Disk Access partially helps, but Terminal.app on the receiver may also need it for any local move/archive.

**Practical workaround:** sync to a non-canonical dir. macOS TCC only protects the Apple-default names — custom dirs are unrestricted. Pattern Jerry uses:

```bash
# rsync target on M2
~/M5-Downloads/   # custom dir, not TCC-protected
```

Trade-off: agents need to know the alternate path. Append a one-line infrastructure note to each per-agent `MEMORY.md`:

> Files Jerry downloads on M5 sync to `~/M5-Downloads/` every 5 min. Check there first when he says "the file I just downloaded."

### Failure modes

| Event | Effect | Recovery |
|---|---|---|
| M5 sleeps/dies | Slock keeps replying. Brain frozen at last GDrive sync. M5 Downloads frozen at last rsync (5 min). | Wake M5 — sync resumes. |
| M2 reboots | KeepAlive respawns daemon. Websocket reconnects ≤60s. | None. |
| api.slock.ai outage | All agents silent. Daemon backs off and retries. | Wait. |
| Split-brain (M5 daemon resurrected) | Both fight over the machine API key. | M5 plist must stay `.disabled-*`. |

### Reference scripts

Step-by-step playbook for the M5→M2 flip lives in iCloud at `~/Library/Mobile Documents/com~apple~CloudDocs/Cloud/`:

- `preflight-slock-flip.sh` — read-only diagnosis (daemon status, log tail, api reachability M5/M2, auth probe, agent inventory, Tailscale).
- `flip-slock-to-m2.sh` — stops M5 daemon, tarballs MEMORY/notes per agent, scp + extract on M2, sed-substitutes plist (`/Users/jerryshi` → `$HOME`), bootstraps.
- `install-slock-on-m2.sh` — self-contained M2 installer (plist heredoc inline) for fresh deployment.

For the rsync side: `~/Ship/sync-daemon/m5-to-m2-downloads.sh` + `~/Library/LaunchAgents/com.jerry.m5-to-m2-downloads.plist` (5-min cadence, locks to prevent overlap, `--delete` for source-of-truth semantics on the synced subset).

---

## Pattern 3 — Multi-Mac (advanced)

Out of scope for this doc. The same gotchas (TCC, auth probe, plist sed) apply at scale. Username substitution at install time matters — different Macs run as different users; canonical `/Users/jerryshi` paths break on `/Users/tongzhoushi`. Use `sed "s|/Users/<source-user>|$HOME|g"` at the destination.
