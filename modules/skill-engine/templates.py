"""SKILL.md template generation for auto-learned skills."""

from datetime import datetime
from typing import Optional


def generate_skill_frontmatter(
    name: str,
    description: str,
    confidence: float = 0.5,
    tags: Optional[list[str]] = None,
) -> str:
    """Generate YAML frontmatter for a skill file."""
    tags_str = ", ".join(tags) if tags else ""
    now = datetime.now().strftime("%Y-%m-%d")
    return f"""---
name: {name}
description: "{description}"
source: auto-generated
created: {now}
times_used: 0
last_used: null
confidence: {confidence:.2f}
tags: [{tags_str}]
---"""


def generate_skill_md(
    name: str,
    description: str,
    trigger_conditions: str,
    procedure: str,
    references: Optional[str] = None,
    task_description: Optional[str] = None,
    confidence: float = 0.5,
    tags: Optional[list[str]] = None,
) -> str:
    """Generate a complete SKILL.md file content."""
    now = datetime.now().strftime("%Y-%m-%d")
    frontmatter = generate_skill_frontmatter(name, description, confidence, tags)
    refs_section = references if references else "None yet."
    task_desc = task_description or "initial task"

    return f"""{frontmatter}

# {name}

## When to Use
{trigger_conditions}

## Procedure
{procedure}

## References
{refs_section}

## History
- {now}: Created from {task_desc}
"""


def generate_history_entry(description: str) -> str:
    """Generate a timestamped history entry."""
    now = datetime.now().strftime("%Y-%m-%d")
    return f"- {now}: {description}"


def generate_improvement_diff(
    old_procedure: str,
    new_procedure: str,
    reason: str,
) -> str:
    """Generate a human-readable diff summary for skill improvement."""
    now = datetime.now().strftime("%Y-%m-%d")
    return f"""### Improvement ({now})
**Reason:** {reason}

**Previous approach:**
{old_procedure}

**Updated approach:**
{new_procedure}
"""
