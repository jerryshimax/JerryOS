"""Core skill detection and generation logic.

This module provides the framework for detecting novel task completions
and generating reusable skills. The calling agent performs the LLM analysis;
this module handles storage, indexing, and lifecycle management.
"""

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from config import (
    LEARNED_DIR,
    MIN_CONFIDENCE,
    MAX_CONFIDENCE,
    NOVELTY_THRESHOLD,
)
from index import (
    add_skill,
    get_connection,
    get_skill,
    record_usage,
    search_skills,
    update_skill_procedure,
)
from templates import generate_history_entry, generate_skill_md


def make_skill_id(name: str) -> str:
    """Generate a deterministic, filesystem-safe skill ID from a name."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    # Add short hash to avoid collisions
    h = hashlib.sha256(name.encode()).hexdigest()[:6]
    return f"{slug}-{h}"


def detect_novelty(
    task_description: str,
    db_path: Optional[Path] = None,
) -> dict:
    """Check if a task description matches any existing skill.

    Returns:
        dict with keys:
            - is_novel: bool — True if no existing skill covers this
            - matches: list of matching skills (sorted by relevance)
            - best_match: the closest skill or None
    """
    conn = get_connection(db_path)
    try:
        matches = search_skills(conn, task_description, limit=5)
        if not matches:
            return {"is_novel": True, "matches": [], "best_match": None}

        # The calling agent decides if these matches are close enough.
        # We provide the raw matches for analysis.
        return {
            "is_novel": len(matches) == 0,
            "matches": matches,
            "best_match": matches[0] if matches else None,
        }
    finally:
        conn.close()


def create_skill(
    name: str,
    description: str,
    trigger_conditions: str,
    procedure: str,
    references: Optional[str] = None,
    task_description: Optional[str] = None,
    confidence: float = 0.5,
    tags: Optional[list[str]] = None,
    db_path: Optional[Path] = None,
    learned_dir: Optional[Path] = None,
) -> dict:
    """Create a new learned skill: writes the .md file and indexes it.

    Returns:
        dict with skill_id, file_path, and indexed status.
    """
    skill_id = make_skill_id(name)
    out_dir = learned_dir or LEARNED_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    file_path = out_dir / f"{skill_id}.md"

    # Generate the markdown content
    content = generate_skill_md(
        name=name,
        description=description,
        trigger_conditions=trigger_conditions,
        procedure=procedure,
        references=references,
        task_description=task_description,
        confidence=confidence,
        tags=tags,
    )

    # Write the file
    file_path.write_text(content, encoding="utf-8")

    # Index it
    conn = get_connection(db_path)
    try:
        add_skill(
            conn,
            skill_id=skill_id,
            name=name,
            description=description,
            file_path=str(file_path),
            confidence=confidence,
            tags=tags,
            trigger_conditions=trigger_conditions,
            procedure=procedure,
        )
    finally:
        conn.close()

    return {
        "skill_id": skill_id,
        "file_path": str(file_path),
        "indexed": True,
    }


def use_skill(
    skill_id: str,
    succeeded: bool = True,
    db_path: Optional[Path] = None,
) -> Optional[dict]:
    """Record that a skill was used and update its confidence.

    Returns the updated skill dict or None if not found.
    """
    conn = get_connection(db_path)
    try:
        record_usage(conn, skill_id, succeeded)
        return get_skill(conn, skill_id)
    finally:
        conn.close()


def improve_skill(
    skill_id: str,
    new_procedure: str,
    reason: str,
    db_path: Optional[Path] = None,
) -> Optional[dict]:
    """Update a skill's procedure and append to its history.

    The calling agent determines that a better approach was found.
    This function handles the file update and re-indexing.

    Returns the updated skill dict or None if not found.
    """
    conn = get_connection(db_path)
    try:
        skill = get_skill(conn, skill_id)
        if not skill:
            return None

        file_path = Path(skill["file_path"])
        if not file_path.exists():
            return None

        content = file_path.read_text(encoding="utf-8")

        # Update procedure section
        procedure_pattern = r"(## Procedure\n)(.*?)((?=\n## )|$)"
        new_procedure_section = f"## Procedure\n{new_procedure}\n"
        content = re.sub(
            procedure_pattern,
            new_procedure_section,
            content,
            count=1,
            flags=re.DOTALL,
        )

        # Append history entry
        history_entry = generate_history_entry(f"Improved: {reason}")
        if "## History" in content:
            content = content.rstrip() + "\n" + history_entry + "\n"
        else:
            content = content.rstrip() + f"\n\n## History\n{history_entry}\n"

        # Write updated file
        file_path.write_text(content, encoding="utf-8")

        # Update index
        update_skill_procedure(conn, skill_id, new_procedure)

        return get_skill(conn, skill_id)
    finally:
        conn.close()


def learn_from_session(session_data: dict) -> dict:
    """Analyze a session log and extract skill-worthy patterns.

    This function provides the STRUCTURE for skill extraction.
    The calling agent (LLM) fills in the semantic analysis.

    Args:
        session_data: dict with keys:
            - task: str — what was asked
            - result: str — what was produced
            - steps: list[str] — steps taken
            - tools_used: list[str] — tools/files used
            - success: bool — whether it was accepted
            - name: str — suggested skill name (from LLM)
            - description: str — one-line description (from LLM)
            - trigger_conditions: str — when to use (from LLM)
            - procedure: str — step-by-step (from LLM)
            - tags: list[str] — relevant tags (from LLM)
            - confidence: float — initial confidence (from LLM)

    Returns:
        dict with: action (created/updated/skipped), skill_id, reason
    """
    if not session_data.get("success", False):
        return {"action": "skipped", "skill_id": None, "reason": "task was not successful"}

    task = session_data.get("task", "")
    if not task:
        return {"action": "skipped", "skill_id": None, "reason": "no task description"}

    # Check novelty
    novelty = detect_novelty(task)

    if novelty["best_match"]:
        # Existing skill found — could be an improvement opportunity
        existing = novelty["best_match"]
        if session_data.get("procedure"):
            # The calling agent determined this is a better approach
            result = improve_skill(
                skill_id=existing["id"],
                new_procedure=session_data["procedure"],
                reason=f"Better approach found during: {task[:100]}",
            )
            if result:
                return {
                    "action": "updated",
                    "skill_id": existing["id"],
                    "reason": f"Improved existing skill: {existing['name']}",
                }

    # Create new skill if we have the required fields from the LLM
    required = ["name", "description", "trigger_conditions", "procedure"]
    missing = [k for k in required if not session_data.get(k)]
    if missing:
        return {
            "action": "skipped",
            "skill_id": None,
            "reason": f"Missing fields for skill creation: {', '.join(missing)}",
        }

    result = create_skill(
        name=session_data["name"],
        description=session_data["description"],
        trigger_conditions=session_data["trigger_conditions"],
        procedure=session_data["procedure"],
        references=session_data.get("references"),
        task_description=task,
        confidence=session_data.get("confidence", 0.5),
        tags=session_data.get("tags"),
    )

    return {
        "action": "created",
        "skill_id": result["skill_id"],
        "reason": f"New skill created: {session_data['name']}",
    }
