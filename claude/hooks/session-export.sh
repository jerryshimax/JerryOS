#!/usr/bin/env bash
# session-export.sh — SessionEnd hook
# Exports the just-ended Claude Code transcript to a portable JSONL,
# refreshes the project + global handoff snapshots, and (optionally)
# ingests into a local Memory MCP session database if one is configured.
#
# Outputs:
#   ~/Ship/logs/sessions/<session-id>.jsonl
#   ~/Ship/logs/handoffs/projects/<project-key>/latest.json
#   ~/Ship/logs/handoffs/global/latest.json
#
# Optional ingestion: set $JERRYOS_INGEST_CLI to a node script that accepts
# the exported jsonl as its first argument. Falls back to a no-op if unset.
#
# Helper: claude/hooks/lib/handoff-lib.sh (sibling to this script after symlink).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/lib/handoff-lib.sh"

if [[ ! -f "$LIB" ]]; then
  exit 0
fi
source "$LIB"

SESSIONS_DIR="${SESSIONS_ROOT:-$HOME/Ship/logs/sessions}"
HANDOFF_ROOT_DIR="${HANDOFF_ROOT:-$HOME/Ship/logs/handoffs}"
INGEST_CLI="${JERRYOS_INGEST_CLI:-}"

mkdir -p "$SESSIONS_DIR" "$HANDOFF_ROOT_DIR"

HOOK_INPUT="$(cat || true)"
TRANSCRIPT_HINT="$(python3 - <<'PY' "$HOOK_INPUT"
import json
import sys

raw = sys.argv[1]
if not raw.strip():
    print("")
    raise SystemExit(0)

try:
    payload = json.loads(raw)
except Exception:
    print("")
    raise SystemExit(0)

print(payload.get("transcript_path", ""))
PY
)"
SESSION_HINT="$(python3 - <<'PY' "$HOOK_INPUT"
import json
import sys

raw = sys.argv[1]
if not raw.strip():
    print("")
    raise SystemExit(0)

try:
    payload = json.loads(raw)
except Exception:
    print("")
    raise SystemExit(0)

print(payload.get("session_id", ""))
PY
)"

LATEST_TRANSCRIPT=""

if [[ -n "$TRANSCRIPT_HINT" && -f "$TRANSCRIPT_HINT" ]]; then
    LATEST_TRANSCRIPT="$TRANSCRIPT_HINT"
elif [[ -n "$SESSION_HINT" ]]; then
    while IFS= read -r -d '' transcript; do
        LATEST_TRANSCRIPT="$transcript"
        break
    done < <(
        find "$HOME/.claude/projects" -mindepth 2 -maxdepth 2 -type f -name "${SESSION_HINT}.jsonl" \
            ! -path '*/subagents/*' ! -path '*/tool-results/*' -print0 2>/dev/null
    )
fi

if [[ -z "$LATEST_TRANSCRIPT" ]]; then
    LATEST_MTIME=0
    while IFS= read -r -d '' transcript; do
        mtime=$(stat -f '%m' "$transcript" 2>/dev/null || stat -c '%Y' "$transcript" 2>/dev/null || echo 0)
        if [ "$mtime" -gt "$LATEST_MTIME" ]; then
            LATEST_MTIME=$mtime
            LATEST_TRANSCRIPT=$transcript
        fi
    done < <(
        find "$HOME/.claude/projects" -mindepth 2 -maxdepth 2 -type f -name '*.jsonl' \
            ! -path '*/subagents/*' ! -path '*/tool-results/*' -print0 2>/dev/null
    )
fi

if [ -z "$LATEST_TRANSCRIPT" ]; then
    exit 0
fi

SESSION_ID=$(basename "$LATEST_TRANSCRIPT" .jsonl)
OUTPUT_FILE="$SESSIONS_DIR/${SESSION_ID}.jsonl"
PROJECT_DIR="$(python3 - "$LATEST_TRANSCRIPT" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
project_root = ""

try:
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue

        cwd = entry.get("cwd")
        if cwd:
            project_root = cwd
            break

        message = entry.get("message")
        if isinstance(message, dict):
            cwd = message.get("cwd")
            if cwd:
                project_root = cwd
                break
except Exception:
    pass

if not project_root:
    project_root = str(path.parent)

print(project_root)
PY
)"

PROJECT_KEY="$(handoff_project_key "$PROJECT_DIR")"
SESSION_EXPORT_PATH="$OUTPUT_FILE"
PROJECT_HANDOFF_PATH="$(handoff_project_latest_path "$PROJECT_DIR")"
GLOBAL_HANDOFF_PATH="$(handoff_global_latest_path)"
HISTORY_HANDOFF_PATH="$(handoff_project_history_path "$PROJECT_DIR" "$SESSION_ID")"

python3 - "$LATEST_TRANSCRIPT" "$SESSION_ID" "$SESSION_EXPORT_PATH" "$PROJECT_DIR" "$PROJECT_KEY" "$PROJECT_HANDOFF_PATH" "$GLOBAL_HANDOFF_PATH" "$HISTORY_HANDOFF_PATH" << 'PYEOF'
import json
import sys
from pathlib import Path
from datetime import datetime
import re

transcript_path = Path(sys.argv[1])
session_id = sys.argv[2]
output_file = Path(sys.argv[3])
project_dir = Path(sys.argv[4])
project_key = sys.argv[5]
project_handoff_path = Path(sys.argv[6])
global_handoff_path = Path(sys.argv[7])
history_handoff_path = Path(sys.argv[8])

lines = []
def extract_text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        pieces = [extract_text(item) for item in value]
        return "\n".join(piece for piece in pieces if piece).strip()
    if isinstance(value, dict):
        if value.get("type") == "tool_use":
            name = value.get("name") or value.get("tool_name") or "tool"
            return f"[tool use: {name}]"
        if "text" in value and isinstance(value["text"], str):
            return value["text"]
        if "content" in value:
            text = extract_text(value["content"])
            if text:
                return text
        if "message" in value:
            text = extract_text(value["message"])
            if text:
                return text
    return ""

def extract_role(entry):
    message = entry.get("message")
    if isinstance(message, dict) and message.get("role"):
        return message["role"]
    if entry.get("role"):
        return entry["role"]
    if entry.get("type") == "queue-operation":
        return "system"
    return entry.get("type", "unknown")

def extract_content(entry):
    message = entry.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if content is not None:
            text = extract_text(content)
            if text:
                return text
        text = extract_text(message)
        if text:
            return text
    if "content" in entry:
        text = extract_text(entry["content"])
        if text:
            return text
    if "message" in entry and isinstance(entry["message"], str):
        return entry["message"]
    return ""

def clip(text, limit=5000):
    text = text or ""
    return text if len(text) <= limit else text[: limit - 1] + "…"

def normalize_whitespace(text):
    return re.sub(r"\s+", " ", (text or "").strip())

def clip_inline(text, limit=240):
    text = normalize_whitespace(text)
    return text if len(text) <= limit else text[: limit - 1] + "…"

def looks_like_task_prompt(text):
    normalized = normalize_whitespace(text)
    lower = normalized.lower()
    if not normalized:
        return False
    if lower in {"done", "yes", "ok", "okay", "continue"}:
        return False
    if normalized.startswith("/Users/") or normalized.startswith("~/"):
        return False
    if normalized.count("/") >= 2 and len(normalized.split()) <= 8:
        return False
    return True

def is_tool_result_message(entry):
    message = entry.get("message")
    if not isinstance(message, dict):
        return False
    content = message.get("content")
    if not isinstance(content, list) or not content:
        return False
    return all(isinstance(item, dict) and item.get("type") == "tool_result" for item in content)

def is_tool_use_message(entry):
    message = entry.get("message")
    if not isinstance(message, dict):
        return False
    content = message.get("content")
    if not isinstance(content, list) or not content:
        return False
    return all(isinstance(item, dict) and item.get("type") == "tool_use" for item in content)

def find_paths(text):
    if not text:
        return []
    patterns = [
        r"(?<!\w)(?:~\/[^\s'\"`<>]+\.[A-Za-z0-9]{1,8}|\/(?:Users|private|tmp|var)\/[^\s'\"`<>]+\.[A-Za-z0-9]{1,8})",
    ]
    paths = []
    for pattern in patterns:
        paths.extend(re.findall(pattern, text))
    seen = set()
    out = []
    for item in paths:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out

message_rows = []
all_turns = []
meaningful_turns = []
user_count = 0
assistant_count = 0
started_at = None
ended_at = None
cwd = ""
git_branch = ""
touched_paths = []

for raw_line in transcript_path.read_text(encoding="utf-8").splitlines():
    if not raw_line.strip():
        continue
    try:
        entry = json.loads(raw_line)
    except json.JSONDecodeError:
        continue
    timestamp = entry.get("timestamp")
    if timestamp:
        if started_at is None or timestamp < started_at:
            started_at = timestamp
        if ended_at is None or timestamp > ended_at:
            ended_at = timestamp

    if not cwd:
        cwd = entry.get("cwd") or ""
    if not git_branch:
        git_branch = entry.get("gitBranch") or ""

    role = extract_role(entry)
    content = clip(extract_content(entry))
    tool_result_only = is_tool_result_message(entry)
    tool_use_only = is_tool_use_message(entry)

    if entry.get("type") == "queue-operation":
        if content:
            message_rows.append({
                "session_id": session_id,
                "role": role,
                "content": content,
                "timestamp": timestamp or datetime.now().isoformat(),
            })
        continue

    if role not in {"user", "assistant", "system"}:
        continue
    if not content:
        continue

    row = {
        "session_id": session_id,
        "role": role,
        "content": content,
        "timestamp": timestamp or datetime.now().isoformat(),
    }

    tool_name = entry.get("tool_name") or entry.get("name")
    if not tool_name:
        message = entry.get("message")
        if isinstance(message, dict):
            tool_name = message.get("tool_name") or message.get("name")
    if tool_name:
        row["tool_name"] = tool_name

    message_rows.append(row)
    if role == "user":
        user_count += 1
        all_turns.append({
            "role": role,
            "content": clip(content, 180),
            "timestamp": timestamp or "",
        })
    elif role == "assistant":
        assistant_count += 1
        all_turns.append({
            "role": role,
            "content": clip(content, 180),
            "timestamp": timestamp or "",
        })

    if role in {"user", "assistant"} and not tool_result_only and not tool_use_only:
        normalized = clip_inline(content, 320)
        if normalized:
            meaningful_turns.append({
                "role": role,
                "content": normalized,
                "timestamp": timestamp or "",
            })

    touched_paths.extend(find_paths(content))

if not cwd:
    cwd = str(project_dir)

unique_paths = []
seen_paths = set()
for item in touched_paths:
    if item not in seen_paths:
        seen_paths.add(item)
        unique_paths.append(item)

recent_turns = meaningful_turns[-6:] if meaningful_turns else all_turns[-6:]
summary_parts = [f"{turn['role']}: {turn['content']}" for turn in recent_turns[-4:]]
summary = " | ".join(summary_parts)

blockers = []
decisions = []
next_step = None
last_completed_step = None
task_prompt = None

for turn in meaningful_turns:
    if turn["role"] == "user" and looks_like_task_prompt(turn["content"]):
        task_prompt = turn["content"]
        break

if task_prompt is None:
    for turn in meaningful_turns:
        if turn["role"] == "user":
            task_prompt = turn["content"]
            break

for turn in reversed(recent_turns):
    text = turn["content"].strip()
    lower = text.lower()
    if next_step is None and any(marker in lower for marker in ("next", "then", "after that")):
        next_step = text
    if last_completed_step is None and turn["role"] == "assistant" and any(marker in lower for marker in ("done", "completed", "finished", "implemented", "sent", "created", "updated", "wrote")):
        last_completed_step = text
    if not blockers and any(marker in lower for marker in ("blocked", "issue", "problem", "cannot", "can't", "stuck")):
        blockers.append(text)
    if not decisions and turn["role"] == "assistant" and any(marker in lower for marker in ("decided", "decision", "recommendation", "will ", "choose", "plan is", "going to")):
        decisions.append(text)

if next_step is None:
    for turn in reversed(meaningful_turns):
        text = turn["content"].strip()
        lower = text.lower()
        if turn["role"] == "assistant" and any(marker in lower for marker in ("i'll ", "i will ", "let me ", "writing ", "working on ", "next ")) and not any(marker in lower for marker in ("done", "completed", "finished", "sent", "resolved")):
            next_step = text
            break

status = "active"
if recent_turns:
    last_turn_text = recent_turns[-1]["content"].strip().lower()
    if any(marker in last_turn_text for marker in ("done", "completed", "finished", "sent", "resolved")):
        status = "completed"
    elif blockers:
        status = "blocked"

if status == "completed":
    next_step = None

title = clip_inline(task_prompt, 160) if task_prompt else None
if not title:
    title = clip_inline(summary_parts[0], 160) if summary_parts else f"Session {session_id}"
if not looks_like_task_prompt(title):
    for turn in reversed(meaningful_turns):
        if turn["role"] == "user" and looks_like_task_prompt(turn["content"]):
            title = clip_inline(turn["content"], 160)
            break

project_latest = {
    "version": 1,
    "kind": "handoff_snapshot",
    "snapshot_scope": "project",
    "session_id": session_id,
    "project_key": project_key,
    "project_root": cwd,
    "cwd": cwd,
    "session_path": str(transcript_path),
    "session_export_path": str(output_file),
    "created_at": started_at or datetime.now().isoformat(),
    "updated_at": ended_at or datetime.now().isoformat(),
    "source_agent": "claude",
    "git": {
        "branch": git_branch or None,
        "sha": None,
        "dirty": None,
    },
    "status": status,
    "title": title,
    "summary": summary,
    "last_completed_step": last_completed_step,
    "next_step": next_step,
    "blockers": blockers,
    "decisions": decisions,
    "touched_paths": unique_paths[:20],
    "related_sessions": [session_id],
    "related_contacts": [],
    "tags": [],
    "message_count": len(message_rows),
    "user_message_count": user_count,
    "assistant_message_count": assistant_count,
    "recent_turns": recent_turns,
}

def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)

if message_rows:
    header = {
        "type": "session",
        "session_id": session_id,
        "started_at": started_at or datetime.now().isoformat(),
        "ended_at": ended_at or started_at or datetime.now().isoformat(),
        "cwd": cwd,
        "project_root": cwd,
        "project_key": project_key,
        "git_branch": git_branch or None,
        "summary": summary or None,
        "last_completed_step": last_completed_step,
        "next_step": next_step,
        "blockers": blockers,
        "decisions": decisions,
        "touched_paths": unique_paths[:20],
        "recent_turns": recent_turns,
    }
    lines.append(json.dumps(header, ensure_ascii=False))
    for row in message_rows:
        lines.append(json.dumps(row, ensure_ascii=False))
    output_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    write_json(history_handoff_path, project_latest)
    write_json(project_handoff_path, project_latest)
    global_latest = dict(project_latest)
    global_latest["snapshot_scope"] = "global"
    write_json(global_handoff_path, global_latest)
PYEOF

# Optional: ingest into a local Memory MCP session database.
if [ -f "$OUTPUT_FILE" ] && [ -n "$INGEST_CLI" ] && [ -f "$INGEST_CLI" ]; then
    node "$INGEST_CLI" "$OUTPUT_FILE" 2>/dev/null || true
fi

exit 0
