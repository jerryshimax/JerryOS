#!/usr/bin/env python3
"""
CLI for the progressive skill loader.

Usage:
  python cli.py build               Rebuild index from ~/.claude/skills/
  python cli.py list                 Print Tier 1 index (all skills, one line each)
  python cli.py search <query>       Search skills by keyword
  python cli.py tag <tag>            Filter skills by tag
  python cli.py summary <name>       Print Tier 2 summary
  python cli.py full <name>          Print Tier 3 full content
  python cli.py stats                Print aggregate statistics
"""

import argparse
import sys

from index_builder import build_index
from loader import SkillLoader


def cmd_build(args: argparse.Namespace) -> None:
    idx = build_index()
    print(f"Index rebuilt: {idx['total_skills']} skills indexed")
    print(f"Generated at: {idx['generated_at']}")


def cmd_list(args: argparse.Namespace) -> None:
    loader = SkillLoader()
    skills = loader.list_skills()
    # Column-aligned output
    max_name = max(len(s["name"]) for s in skills) if skills else 0
    for s in skills:
        tags = ", ".join(s.get("tags", []))
        print(f"  {s['name']:<{max_name}}  {s['size_lines']:>4}L  [{tags}]")
    print(f"\n  {len(skills)} skills total")


def cmd_search(args: argparse.Namespace) -> None:
    loader = SkillLoader()
    results = loader.search_skills(args.query)
    if not results:
        print(f"No skills match '{args.query}'")
        return
    max_name = max(len(s["name"]) for s in results)
    for s in results:
        desc = s.get("description", "")[:80]
        print(f"  {s['name']:<{max_name}}  {desc}")
    print(f"\n  {len(results)} results")


def cmd_tag(args: argparse.Namespace) -> None:
    loader = SkillLoader()
    results = loader.search_by_tag(args.tag)
    if not results:
        print(f"No skills tagged '{args.tag}'")
        return
    max_name = max(len(s["name"]) for s in results)
    for s in results:
        desc = s.get("description", "")[:80]
        print(f"  {s['name']:<{max_name}}  {desc}")
    print(f"\n  {len(results)} skills tagged '{args.tag}'")


def cmd_summary(args: argparse.Namespace) -> None:
    loader = SkillLoader()
    summary = loader.get_summary(args.name)
    if summary is None:
        print(f"No summary found for '{args.name}'")
        sys.exit(1)
    print(summary)


def cmd_full(args: argparse.Namespace) -> None:
    loader = SkillLoader()
    full = loader.get_full(args.name)
    if full is None:
        print(f"No skill found for '{args.name}'")
        sys.exit(1)
    print(full)


def cmd_stats(args: argparse.Namespace) -> None:
    loader = SkillLoader()
    s = loader.stats()
    if s["total"] == 0:
        print("No skills indexed. Run `python cli.py build` first.")
        return
    print(f"  Total skills:     {s['total']}")
    print(f"  Total lines:      {s['total_lines']}")
    print(f"  Avg lines/skill:  {s['avg_lines']}")
    print(f"  Min lines:        {s['min_lines']}")
    print(f"  Max lines:        {s['max_lines']}  ({s['largest_skill']})")
    print(f"\n  Tag distribution:")
    for tag, count in s["tag_distribution"].items():
        print(f"    {tag:<16} {count}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Progressive Skill Loader CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("build", help="Rebuild index from ~/.claude/skills/")
    sub.add_parser("list", help="List all skills (Tier 1)")

    p_search = sub.add_parser("search", help="Search skills by keyword")
    p_search.add_argument("query", help="Search query")

    p_tag = sub.add_parser("tag", help="Filter skills by tag")
    p_tag.add_argument("tag", help="Tag to filter by")

    p_summary = sub.add_parser("summary", help="Show Tier 2 summary")
    p_summary.add_argument("name", help="Skill name")

    p_full = sub.add_parser("full", help="Show Tier 3 full content")
    p_full.add_argument("name", help="Skill name")

    sub.add_parser("stats", help="Show aggregate statistics")

    args = parser.parse_args()
    commands = {
        "build": cmd_build,
        "list": cmd_list,
        "search": cmd_search,
        "tag": cmd_tag,
        "summary": cmd_summary,
        "full": cmd_full,
        "stats": cmd_stats,
    }
    commands[args.command](args)


if __name__ == "__main__":
    main()
