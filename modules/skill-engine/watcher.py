"""Monitors agent outputs for skill-worthy patterns.

Watches session logs in ~/Ship/logs/ and extracts structured session data
that can be fed into engine.learn_from_session(). The actual semantic analysis
(is this novel? is it generalizable?) is done by the calling agent — this
module handles file watching, parsing, and queuing.
"""

import json
import os
import time
from pathlib import Path
from typing import Callable, Optional

from config import LOGS_DIR


def parse_session_log(log_path: Path) -> Optional[dict]:
    """Parse a session log file into structured session data.

    Expects JSON or JSONL format with at minimum:
        - task: what was asked
        - result: what was produced
        - success: bool

    Returns parsed dict or None if unparseable.
    """
    try:
        content = log_path.read_text(encoding="utf-8")

        # Try JSON first
        try:
            data = json.loads(content)
            if isinstance(data, dict) and "task" in data:
                return data
        except json.JSONDecodeError:
            pass

        # Try JSONL — take the last complete entry
        lines = [l.strip() for l in content.splitlines() if l.strip()]
        for line in reversed(lines):
            try:
                data = json.loads(line)
                if isinstance(data, dict) and "task" in data:
                    return data
            except json.JSONDecodeError:
                continue

        return None
    except (OSError, UnicodeDecodeError):
        return None


def scan_logs(
    logs_dir: Optional[Path] = None,
    since_mtime: Optional[float] = None,
    pattern: str = "*.json",
) -> list[tuple[Path, dict]]:
    """Scan log directory for session files.

    Args:
        logs_dir: directory to scan (defaults to ~/Ship/logs/)
        since_mtime: only return files modified after this timestamp
        pattern: glob pattern for log files

    Returns:
        list of (path, parsed_data) tuples for valid session logs
    """
    directory = logs_dir or LOGS_DIR
    if not directory.exists():
        return []

    results = []
    for log_path in sorted(directory.glob(pattern), key=lambda p: p.stat().st_mtime):
        if since_mtime and log_path.stat().st_mtime <= since_mtime:
            continue
        data = parse_session_log(log_path)
        if data:
            results.append((log_path, data))

    return results


def watch_logs(
    callback: Callable[[Path, dict], None],
    logs_dir: Optional[Path] = None,
    poll_interval: float = 5.0,
    pattern: str = "*.json",
) -> None:
    """Continuously watch for new session logs and call callback for each.

    This is a simple polling watcher. For production use, consider
    using watchdog or fsevents.

    Args:
        callback: function(path, data) called for each new log
        logs_dir: directory to watch
        poll_interval: seconds between polls
        pattern: glob pattern
    """
    directory = logs_dir or LOGS_DIR
    directory.mkdir(parents=True, exist_ok=True)

    last_mtime = time.time()
    seen_files: set[str] = set()

    print(f"Watching {directory} for session logs (pattern: {pattern})")

    try:
        while True:
            for log_path, data in scan_logs(directory, pattern=pattern):
                path_str = str(log_path)
                if path_str not in seen_files:
                    seen_files.add(path_str)
                    if log_path.stat().st_mtime >= last_mtime:
                        try:
                            callback(log_path, data)
                        except Exception as e:
                            print(f"Error processing {log_path}: {e}")

            last_mtime = time.time()
            time.sleep(poll_interval)
    except KeyboardInterrupt:
        print("\nStopped watching.")


def create_session_log(
    task: str,
    result: str,
    success: bool,
    steps: Optional[list[str]] = None,
    tools_used: Optional[list[str]] = None,
    output_path: Optional[Path] = None,
    extra: Optional[dict] = None,
) -> Path:
    """Helper to create a properly formatted session log file.

    Used by agents to write their output in a format the watcher understands.

    Returns the path to the created log file.
    """
    logs_dir = LOGS_DIR
    logs_dir.mkdir(parents=True, exist_ok=True)

    timestamp = time.strftime("%Y%m%d-%H%M%S")
    if output_path is None:
        output_path = logs_dir / f"session-{timestamp}.json"

    data = {
        "task": task,
        "result": result,
        "success": success,
        "steps": steps or [],
        "tools_used": tools_used or [],
        "timestamp": timestamp,
    }
    if extra:
        data.update(extra)

    output_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return output_path
