#!/usr/bin/env bash
# handoff-context.sh — emit a compact bootstrap context from the latest
# handoff snapshot. Used by claude-session-start.sh to seed a new session.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/handoff-lib.sh"

PROJECT_DIR="${1:-$PWD}"

if ! SNAPSHOT_PATH="$(handoff_latest_context_path "$PROJECT_DIR" 2>/dev/null)"; then
  exit 0
fi

python3 - "$SNAPSHOT_PATH" "$PROJECT_DIR" <<'PY'
import json
import sys
from pathlib import Path
import hashlib
import os

path = Path(sys.argv[1])
project_dir = sys.argv[2]

def project_key(project_root):
    abs_path = os.path.realpath(project_root)
    base = os.path.basename(abs_path) or "root"
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in base).strip("-") or "root"
    digest = hashlib.sha1(abs_path.encode("utf-8")).hexdigest()[:12]
    return f"{safe.lower()}-{digest}"

try:
    snapshot = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(0)

def is_low_signal(data):
    text = " ".join(
        str(data.get(key, "")) for key in ("title", "summary", "next_step", "last_completed_step")
    ).lower()
    markers = [
        "what were we just doing",
        "what were we doing",
        "context_bootstrap",
        "list the available tools",
        "use the memory mcp tool",
        "i don't have context from a previous conversation",
    ]
    return any(marker in text for marker in markers)

if is_low_signal(snapshot):
    history_dir = Path.home() / "Ship" / "logs" / "handoffs" / "history" / project_key(project_dir)
    if history_dir.exists():
        candidates = sorted(
            history_dir.glob("*.json"),
            key=lambda candidate: candidate.stat().st_mtime,
            reverse=True,
        )
        for candidate in candidates:
            try:
                candidate_snapshot = json.loads(candidate.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not is_low_signal(candidate_snapshot):
                snapshot = candidate_snapshot
                path = candidate
                break

def clip(value, length=240):
    if not value:
        return ""
    text = str(value).strip().replace("\n", " ")
    return text if len(text) <= length else text[: length - 1] + "…"

def join_list(values, limit=8):
    items = [clip(v, 80) for v in (values or []) if str(v).strip()]
    if not items:
        return ""
    if len(items) > limit:
        items = items[:limit] + [f"+{len(items) - limit} more"]
    return "; ".join(items)

lines = [
    f"Snapshot: {path}",
    f"Session: {snapshot.get('session_id', 'unknown')}",
    f"Project root: {snapshot.get('project_root') or snapshot.get('cwd') or 'unknown'}",
    f"Status: {snapshot.get('status', 'unknown')}",
]

title = clip(snapshot.get("title"), 140)
summary = clip(snapshot.get("summary"), 320)
last_completed = clip(snapshot.get("last_completed_step"), 160)
next_step = clip(snapshot.get("next_step"), 160)
blockers = join_list(snapshot.get("blockers"), 5)
decisions = join_list(snapshot.get("decisions"), 5)
touched_paths = join_list(snapshot.get("touched_paths"), 6)
contacts = join_list(snapshot.get("related_contacts"), 6)

if title:
    lines.append(f"Title: {title}")
if summary:
    lines.append(f"Summary: {summary}")
if last_completed:
    lines.append(f"Last completed: {last_completed}")
if next_step:
    lines.append(f"Next step: {next_step}")
if blockers:
    lines.append(f"Blockers: {blockers}")
if decisions:
    lines.append(f"Decisions: {decisions}")
if touched_paths:
    lines.append(f"Touched paths: {touched_paths}")
if contacts:
    lines.append(f"Related contacts: {contacts}")

recent_turns = snapshot.get("recent_turns") or []
if recent_turns:
    lines.append("Recent turns:")
    for turn in recent_turns[:4]:
        role = turn.get("role", "unknown")
        text = clip(turn.get("content"), 180)
        if text:
            lines.append(f"- {role}: {text}")

sys.stdout.write("\n".join(lines).strip() + "\n")
PY
