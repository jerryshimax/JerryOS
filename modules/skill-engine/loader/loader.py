"""
Three-tier progressive skill loader.

  Tier 1: Metadata index (list_skills, search_skills)
  Tier 2: Summaries (get_summary)
  Tier 3: Full SKILL.md (get_full)
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

LOADER_DIR = Path(__file__).resolve().parent
INDEX_PATH = LOADER_DIR / "skill_index.json"
SUMMARIES_DIR = LOADER_DIR / "summaries"


class SkillLoader:
    """Progressive three-tier skill loader."""

    def __init__(self, index_path: Path | None = None):
        self._index_path = index_path or INDEX_PATH
        self._index: dict[str, Any] | None = None

    def _load_index(self) -> dict[str, Any]:
        if self._index is None:
            if not self._index_path.exists():
                raise FileNotFoundError(
                    f"Skill index not found at {self._index_path}. "
                    "Run `python index_builder.py` or `python cli.py build` first."
                )
            self._index = json.loads(self._index_path.read_text(encoding="utf-8"))
        return self._index

    def _skills_root(self) -> Path:
        idx = self._load_index()
        return Path(idx.get("skills_root", str(Path.home() / ".claude" / "skills")))

    # ── Tier 1: Metadata ──────────────────────────────────────────────

    def list_skills(self) -> list[dict[str, Any]]:
        """Return compact metadata for all skills."""
        return self._load_index()["skills"]

    def get_metadata(self, name: str) -> dict[str, Any] | None:
        """Return metadata for a single skill by name."""
        for s in self.list_skills():
            if s["name"] == name:
                return s
        return None

    def search_skills(self, query: str) -> list[dict[str, Any]]:
        """Full-text search over skill names, descriptions, and tags."""
        terms = query.lower().split()
        results: list[tuple[int, dict[str, Any]]] = []

        for skill in self.list_skills():
            searchable = " ".join([
                skill["name"],
                skill.get("description", ""),
                " ".join(skill.get("tags", [])),
            ]).lower()

            score = sum(1 for t in terms if t in searchable)
            # Boost exact name match
            if query.lower() == skill["name"].lower():
                score += 10
            # Boost name substring
            elif query.lower() in skill["name"].lower():
                score += 3

            if score > 0:
                results.append((score, skill))

        results.sort(key=lambda x: (-x[0], x[1]["name"]))
        return [r[1] for r in results]

    def search_by_tag(self, tag: str) -> list[dict[str, Any]]:
        """Return all skills with a given tag."""
        tag_lower = tag.lower()
        return [s for s in self.list_skills() if tag_lower in [t.lower() for t in s.get("tags", [])]]

    # ── Tier 2: Summary ───────────────────────────────────────────────

    def get_summary(self, name: str) -> str | None:
        """Return the 10-20 line summary for a skill."""
        summary_path = SUMMARIES_DIR / f"{name}.md"
        if summary_path.exists():
            return summary_path.read_text(encoding="utf-8")
        return None

    # ── Tier 3: Full SKILL.md ─────────────────────────────────────────

    def get_full(self, name: str) -> str | None:
        """Return the complete SKILL.md content."""
        meta = self.get_metadata(name)
        if not meta:
            return None

        # Learned skills store abs_path; regular skills use relative path from root
        if meta.get("abs_path"):
            full_path = Path(meta["abs_path"])
        else:
            full_path = self._skills_root() / meta["path"]

        if full_path.exists():
            return full_path.read_text(encoding="utf-8")
        return None

    # ── Stats ─────────────────────────────────────────────────────────

    def stats(self) -> dict[str, Any]:
        """Aggregate stats about the skill library."""
        skills = self.list_skills()
        if not skills:
            return {"total": 0}

        sizes = [s["size_lines"] for s in skills]
        tags: dict[str, int] = {}
        for s in skills:
            for t in s.get("tags", []):
                tags[t] = tags.get(t, 0) + 1

        largest = max(skills, key=lambda s: s["size_lines"])

        return {
            "total": len(skills),
            "total_lines": sum(sizes),
            "avg_lines": round(sum(sizes) / len(sizes)),
            "min_lines": min(sizes),
            "max_lines": max(sizes),
            "largest_skill": largest["name"],
            "tag_distribution": dict(sorted(tags.items(), key=lambda x: -x[1])),
        }
