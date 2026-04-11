#!/usr/bin/env python3
"""
File watcher that auto-rebuilds the skill index when SKILL.md files change.

Usage:
  python watcher.py              # Watch ~/.claude/skills/ (foreground)
  python watcher.py --once       # Single rebuild + exit (for cron/hook use)
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler, FileSystemEvent
except ImportError:
    print("watchdog not installed. Run: pip install watchdog")
    sys.exit(1)

from index_builder import build_index, SKILLS_ROOT, LEARNED_ROOT


class SkillChangeHandler(FileSystemEventHandler):
    """Rebuild index when any .md file in skills tree changes."""

    def __init__(self) -> None:
        self._debounce_ts: float = 0
        self._debounce_sec: float = 2.0

    def _should_handle(self, path: str) -> bool:
        return path.endswith(".md")

    def _rebuild(self) -> None:
        now = time.time()
        if now - self._debounce_ts < self._debounce_sec:
            return
        self._debounce_ts = now
        try:
            idx = build_index()
            print(f"[{time.strftime('%H:%M:%S')}] Rebuilt: {idx['total_skills']} skills")
        except Exception as e:
            print(f"[{time.strftime('%H:%M:%S')}] Error rebuilding: {e}")

    def on_modified(self, event: FileSystemEvent) -> None:
        if not event.is_directory and self._should_handle(event.src_path):
            self._rebuild()

    def on_created(self, event: FileSystemEvent) -> None:
        if not event.is_directory and self._should_handle(event.src_path):
            self._rebuild()

    def on_deleted(self, event: FileSystemEvent) -> None:
        if not event.is_directory and self._should_handle(event.src_path):
            self._rebuild()


def watch(skills_root: Path | None = None) -> None:
    root = skills_root or SKILLS_ROOT
    learned = LEARNED_ROOT
    print(f"Watching {root} for SKILL.md changes...")
    if learned.exists():
        print(f"Watching {learned} for learned skill changes...")
    print("Press Ctrl+C to stop.\n")

    # Initial build (scans both roots)
    idx = build_index(root)
    print(f"Initial build: {idx['total_skills']} skills\n")

    observer = Observer()
    handler = SkillChangeHandler()
    observer.schedule(handler, str(root), recursive=True)
    if learned.exists():
        observer.schedule(handler, str(learned), recursive=True)
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
        print("\nStopped.")
    observer.join()


def main() -> None:
    parser = argparse.ArgumentParser(description="Skill index file watcher")
    parser.add_argument("--once", action="store_true", help="Single rebuild then exit")
    args = parser.parse_args()

    if args.once:
        idx = build_index()
        print(f"Built: {idx['total_skills']} skills")
    else:
        watch()


if __name__ == "__main__":
    main()
