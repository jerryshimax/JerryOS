"""
Scans ~/.claude/skills/ for SKILL.md files, builds:
  - Tier 1: skill_index.json  (compact metadata)
  - Tier 2: summaries/{name}.md  (identity + triggers + capabilities)
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

SKILLS_ROOT = Path.home() / ".claude" / "skills"
LEARNED_ROOT = Path.home() / "Ship" / "skill-engine" / "learned"
LOADER_DIR = Path(__file__).resolve().parent
INDEX_PATH = LOADER_DIR / "skill_index.json"
SUMMARIES_DIR = LOADER_DIR / "summaries"


def parse_frontmatter(text: str) -> dict[str, Any]:
    """Extract YAML-like frontmatter from SKILL.md."""
    match = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not match:
        return {}
    fm: dict[str, Any] = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            val = val.strip().strip('"').strip("'")
            if val.lower() in ("true", "false"):
                val = val.lower() == "true"
            fm[key.strip()] = val
    return fm


def extract_section(text: str, heading: str) -> str | None:
    """Extract content under a ## heading until the next ## or end."""
    pattern = rf"^##\s+{re.escape(heading)}\b.*?\n(.*?)(?=\n##\s|\Z)"
    m = re.search(pattern, text, re.DOTALL | re.MULTILINE)
    return m.group(1).strip() if m else None


def extract_section_fuzzy(text: str, keywords: list[str]) -> str | None:
    """Extract first section whose heading contains any keyword (case-insensitive)."""
    sections = re.split(r"\n(?=##\s)", text)
    for sec in sections:
        heading_match = re.match(r"##\s+(.*)", sec)
        if heading_match:
            h = heading_match.group(1).lower()
            if any(kw.lower() in h for kw in keywords):
                body = sec[heading_match.end():].strip()
                return body
    return None


def infer_tags(name: str, description: str, text: str) -> list[str]:
    """Infer tags from skill content."""
    tags: set[str] = set()
    combined = f"{name} {description} {text[:500]}".lower()

    tag_map = {
        "PE": ["pe ", "buyout", "infrastructure", "lbo", "ebitda"],
        "VC": ["vc ", "venture", "startup", "founder", "seed", "series"],
        "deals": ["deal", "memo", "screening", "ic memo", "investment"],
        "research": ["sector", "market", "research", "landscape", "tam"],
        "operations": ["operating", "value creation", "100-day", "ops", "portfolio"],
        "legal": ["legal", "contract", "spa", "lpa", "term sheet", "safe"],
        "finance": ["financial", "model", "dcf", "lbo", "returns", "cap table"],
        "engineering": ["build", "ship", "dashboard", "frontend", "backend", "deploy"],
        "fundraising": ["lp", "fundrais", "ddq", "quarterly report"],
        "brand": ["brand", "marketing", "positioning", "narrative"],
        "diligence": ["dd", "diligence", "reference check"],
        "macro": ["macro", "equities", "rates", "commodities", "fx"],
        "system": ["health-check", "doctor", "integration", "mcp"],
    }

    for tag, keywords in tag_map.items():
        if any(kw in combined for kw in keywords):
            tags.add(tag)

    return sorted(tags)


def build_summary(name: str, text: str) -> str:
    """Build a Tier 2 summary: identity + triggers + key capabilities."""
    lines: list[str] = [f"# {name}\n"]

    # Identity
    identity = extract_section(text, "Identity")
    if identity:
        # Take first 2-3 paragraphs (the core identity + personality)
        paras = [p.strip() for p in identity.split("\n\n") if p.strip()]
        lines.append("## Identity\n")
        lines.extend(paras[:3])
        lines.append("")

    # When to deploy / triggers
    triggers = extract_section_fuzzy(text, ["When to Deploy", "Trigger", "When to Use"])
    if triggers:
        lines.append("## When to Deploy\n")
        lines.append(triggers[:500])
        lines.append("")

    # Workflow overview (just phase names / numbered steps, first 10 lines)
    workflow = extract_section_fuzzy(text, ["Workflow", "Instructions", "How"])
    if workflow:
        wf_lines = workflow.splitlines()[:12]
        lines.append("## Key Steps\n")
        lines.extend(wf_lines)
        lines.append("")

    # Entity context (brief)
    entity = extract_section_fuzzy(text, ["Entity", "Context"])
    if entity:
        entity_lines = entity.splitlines()[:8]
        lines.append("## Entity Context\n")
        lines.extend(entity_lines)
        lines.append("")

    # Agent army (if president)
    army = extract_section_fuzzy(text, ["Agent Army", "Agents", "Orchestrat"])
    if army:
        army_lines = army.splitlines()[:15]
        lines.append("## Agent Army\n")
        lines.extend(army_lines)
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def scan_skill(skill_path: Path, root: Path = SKILLS_ROOT) -> dict[str, Any] | None:
    """Process one SKILL.md file into index entry + summary."""
    try:
        text = skill_path.read_text(encoding="utf-8")
    except Exception:
        return None

    fm = parse_frontmatter(text)
    if not fm.get("name"):
        # Infer name from directory or filename
        if skill_path.name == "SKILL.md":
            fm["name"] = skill_path.parent.name
        else:
            fm["name"] = skill_path.stem

    name = fm["name"]
    description = fm.get("description", "")
    line_count = len(text.splitlines())
    stat = skill_path.stat()
    last_modified = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d")

    # Determine source and path
    is_learned = str(LEARNED_ROOT) in str(skill_path)
    try:
        rel_path = str(skill_path.relative_to(root))
    except ValueError:
        rel_path = str(skill_path)

    tags = infer_tags(name, description, text)

    # Build and write summary
    summary = build_summary(name, text)
    summary_path = SUMMARIES_DIR / f"{name}.md"
    summary_path.write_text(summary, encoding="utf-8")

    entry: dict[str, Any] = {
        "name": name,
        "description": description,
        "tags": tags,
        "path": rel_path,
        "size_lines": line_count,
        "last_modified": last_modified,
    }

    if is_learned:
        entry["source"] = "learned"
        entry["abs_path"] = str(skill_path)

    return entry


def build_index(
    skills_root: Path | None = None,
    extra_roots: Optional[List[Path]] = None,
) -> dict[str, Any]:
    """Scan all SKILL.md files and build the index.

    Scans the primary skills root (~/.claude/skills/) plus any extra roots.
    By default, also scans ~/Ship/skill-engine/learned/ for auto-learned skills.
    """
    root = skills_root or SKILLS_ROOT
    SUMMARIES_DIR.mkdir(parents=True, exist_ok=True)

    entries: list[dict[str, Any]] = []
    seen_names: set[str] = set()

    # Scan primary skills root (SKILL.md files in subdirectories)
    for sf in sorted(root.rglob("SKILL.md")):
        entry = scan_skill(sf, root)
        if entry and entry["name"] not in seen_names:
            entries.append(entry)
            seen_names.add(entry["name"])

    # Scan learned skills and any extra roots
    scan_roots = extra_roots if extra_roots is not None else [LEARNED_ROOT]
    for extra in scan_roots:
        if not extra.exists():
            continue
        # Learned skills are .md files (not necessarily named SKILL.md)
        for sf in sorted(extra.glob("*.md")):
            entry = scan_skill(sf, extra)
            if entry and entry["name"] not in seen_names:
                entries.append(entry)
                seen_names.add(entry["name"])

    # Sort by name
    entries.sort(key=lambda e: e["name"])

    index = {
        "skills": entries,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_skills": len(entries),
        "skills_root": str(root),
        "learned_root": str(LEARNED_ROOT),
    }

    INDEX_PATH.write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")
    return index


if __name__ == "__main__":
    idx = build_index()
    print(f"Built index: {idx['total_skills']} skills")
    print(f"Index: {INDEX_PATH}")
    print(f"Summaries: {SUMMARIES_DIR}/")
