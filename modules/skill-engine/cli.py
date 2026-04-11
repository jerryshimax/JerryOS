#!/usr/bin/env python3
"""CLI for the skill engine — list, search, promote, delete, and manage learned skills.

Uses only stdlib (argparse) — no external dependencies.
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

# Allow running from any directory
sys.path.insert(0, str(Path(__file__).parent))

from config import CLAUDE_SKILLS_DIR, LEARNED_DIR
from engine import create_skill, learn_from_session, use_skill
from index import (
    delete_skill,
    get_connection,
    get_skill,
    get_stats,
    list_skills,
    prune_skills,
    search_skills,
)
from watcher import parse_session_log


def cmd_list(args):
    """List all learned skills."""
    sort_map = {
        "confidence": "confidence DESC",
        "used": "times_used DESC",
        "created": "created DESC",
        "name": "name ASC",
    }
    order = sort_map.get(args.sort, "confidence DESC")
    conn = get_connection()
    skills = list_skills(conn, order_by=order, limit=args.limit)
    conn.close()

    if not skills:
        print("No skills learned yet.")
        return

    print(f"\n{'ID':<35} {'Name':<30} {'Conf':>5} {'Used':>5} {'Created':<12}")
    print("-" * 90)
    for s in skills:
        print(
            f"{s['id']:<35} {s['name'][:29]:<30} {s['confidence']:>5.2f} "
            f"{s['times_used']:>5} {s['created']:<12}"
        )
    print(f"\nTotal: {len(skills)} skills")


def cmd_search(args):
    """Full-text search across all skills."""
    conn = get_connection()
    results = search_skills(conn, args.query, limit=args.limit)
    conn.close()

    if not results:
        print(f'No skills matching "{args.query}"')
        return

    print(f'\nResults for "{args.query}":\n')
    for s in results:
        tags = json.loads(s.get("tags", "[]")) if isinstance(s.get("tags"), str) else s.get("tags", [])
        tags_str = ", ".join(tags) if tags else ""
        print(f"  [{s['confidence']:.2f}] {s['name']}")
        print(f"         {s['description']}")
        if tags_str:
            print(f"         tags: {tags_str}")
        print(f"         id: {s['id']}  used: {s['times_used']}x")
        print()


def cmd_show(args):
    """Show full details for a skill."""
    conn = get_connection()
    skill = get_skill(conn, args.skill_id)
    conn.close()

    if not skill:
        print(f"Skill not found: {args.skill_id}")
        sys.exit(1)

    print(f"\n  Name: {skill['name']}")
    print(f"  Description: {skill['description']}")
    print(f"  Confidence: {skill['confidence']:.2f}")
    print(f"  Times used: {skill['times_used']}")
    print(f"  Last used: {skill['last_used'] or 'never'}")
    print(f"  Created: {skill['created']}")
    print(f"  File: {skill['file_path']}")

    tags = json.loads(skill.get("tags", "[]")) if isinstance(skill.get("tags"), str) else skill.get("tags", [])
    if tags:
        print(f"  Tags: {', '.join(tags)}")

    file_path = Path(skill["file_path"])
    if file_path.exists():
        print(f"\n--- SKILL.md ---\n")
        print(file_path.read_text(encoding="utf-8"))


def cmd_promote(args):
    """Promote a learned skill to ~/.claude/skills/."""
    conn = get_connection()
    skill = get_skill(conn, args.skill_id)
    conn.close()

    if not skill:
        print(f"Skill not found: {args.skill_id}")
        sys.exit(1)

    src = Path(skill["file_path"])
    if not src.exists():
        print(f"Skill file missing: {src}")
        sys.exit(1)

    if not args.yes:
        answer = input(f"Promote '{skill['name']}' to ~/.claude/skills/? [y/N] ")
        if answer.lower() != "y":
            print("Cancelled.")
            return

    dest_dir = CLAUDE_SKILLS_DIR / args.skill_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / "SKILL.md"

    shutil.copy2(str(src), str(dest))
    print(f"Promoted: {src} -> {dest}")
    print("Review and edit the promoted skill before using it with agents.")


def cmd_delete(args):
    """Delete a learned skill."""
    conn = get_connection()
    skill = get_skill(conn, args.skill_id)

    if not skill:
        conn.close()
        print(f"Skill not found: {args.skill_id}")
        sys.exit(1)

    if not args.yes:
        answer = input(f"Delete skill '{skill['name']}'? [y/N] ")
        if answer.lower() != "y":
            conn.close()
            print("Cancelled.")
            return

    file_path = Path(skill["file_path"])
    if file_path.exists() and str(LEARNED_DIR) in str(file_path):
        file_path.unlink()
        print(f"Deleted file: {file_path}")

    delete_skill(conn, args.skill_id)
    conn.close()
    print(f"Deleted skill: {args.skill_id}")


def cmd_stats(args):
    """Show usage statistics."""
    conn = get_connection()
    s = get_stats(conn)
    skills = list_skills(conn, order_by="times_used DESC", limit=5)
    conn.close()

    print("\n=== Skill Engine Stats ===\n")
    print(f"  Total skills:      {s['total_skills']}")
    print(f"  Avg confidence:    {s['avg_confidence'] or 0:.3f}")
    print(f"  Total uses:        {s['total_uses'] or 0}")
    avg_sr = s['avg_success_rate'] or 0
    print(f"  Avg success rate:  {avg_sr:.1%}")
    print(f"  High confidence:   {s['high_confidence_count']} (>= 0.7)")
    print(f"  Low confidence:    {s['low_confidence_count']} (< 0.3)")

    if skills and any(sk["times_used"] > 0 for sk in skills):
        print("\n  Most Used:")
        for sk in skills:
            if sk["times_used"] > 0:
                print(f"    {sk['times_used']:>3}x  {sk['name']} ({sk['confidence']:.2f})")

    learned_files = list(LEARNED_DIR.glob("*.md"))
    print(f"\n  Learned files on disk: {len(learned_files)}")


def cmd_learn(args):
    """Manually feed a session log for skill extraction."""
    log_path = Path(args.session_log)
    if not log_path.exists():
        print(f"File not found: {log_path}")
        sys.exit(1)

    data = parse_session_log(log_path)
    if not data:
        print(f"Could not parse session log: {log_path}")
        sys.exit(1)

    result = learn_from_session(data)
    print(f"\nAction: {result['action']}")
    print(f"Reason: {result['reason']}")
    if result["skill_id"]:
        print(f"Skill ID: {result['skill_id']}")


def cmd_prune(args):
    """Remove skills below a confidence threshold."""
    if not args.yes:
        answer = input(f"Prune skills below {args.below:.2f} confidence? [y/N] ")
        if answer.lower() != "y":
            print("Cancelled.")
            return

    conn = get_connection()
    deleted = prune_skills(conn, below_confidence=args.below)
    conn.close()

    if not deleted:
        print(f"No skills below {args.below:.2f} confidence.")
    else:
        print(f"Pruned {len(deleted)} skills:")
        for sid in deleted:
            print(f"  - {sid}")


def cmd_record(args):
    """Record a skill usage (success or failure)."""
    result = use_skill(args.skill_id, succeeded=args.success)
    if result:
        status = "success" if args.success else "failure"
        print(
            f"Recorded {status} for: {result['name']} "
            f"(confidence: {result['confidence']:.2f}, used: {result['times_used']}x)"
        )
    else:
        print(f"Skill not found: {args.skill_id}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        prog="skill-engine",
        description="Skill Engine — auto-learn and manage reusable agent skills.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # list
    p_list = subparsers.add_parser("list", help="List all learned skills")
    p_list.add_argument("--sort", default="confidence",
                        choices=["confidence", "used", "created", "name"])
    p_list.add_argument("--limit", type=int, default=50)
    p_list.set_defaults(func=cmd_list)

    # search
    p_search = subparsers.add_parser("search", help="Full-text search")
    p_search.add_argument("query")
    p_search.add_argument("--limit", type=int, default=10)
    p_search.set_defaults(func=cmd_search)

    # show
    p_show = subparsers.add_parser("show", help="Show full skill details")
    p_show.add_argument("skill_id")
    p_show.set_defaults(func=cmd_show)

    # promote
    p_promote = subparsers.add_parser("promote", help="Promote to ~/.claude/skills/")
    p_promote.add_argument("skill_id")
    p_promote.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")
    p_promote.set_defaults(func=cmd_promote)

    # delete
    p_delete = subparsers.add_parser("delete", help="Delete a skill")
    p_delete.add_argument("skill_id")
    p_delete.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")
    p_delete.set_defaults(func=cmd_delete)

    # stats
    p_stats = subparsers.add_parser("stats", help="Usage statistics")
    p_stats.set_defaults(func=cmd_stats)

    # learn
    p_learn = subparsers.add_parser("learn", help="Learn from a session log")
    p_learn.add_argument("session_log", help="Path to JSON session log")
    p_learn.set_defaults(func=cmd_learn)

    # prune
    p_prune = subparsers.add_parser("prune", help="Remove low-confidence skills")
    p_prune.add_argument("--below", type=float, default=0.3)
    p_prune.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")
    p_prune.set_defaults(func=cmd_prune)

    # record
    p_record = subparsers.add_parser("record", help="Record skill usage")
    p_record.add_argument("skill_id")
    p_record.add_argument("--success", action="store_true", default=True)
    p_record.add_argument("--failure", dest="success", action="store_false")
    p_record.set_defaults(func=cmd_record)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
