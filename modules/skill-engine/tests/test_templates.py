"""Tests for SKILL.md template generation."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from templates import (
    generate_history_entry,
    generate_improvement_diff,
    generate_skill_frontmatter,
    generate_skill_md,
)


class TestFrontmatter(unittest.TestCase):
    def test_basic(self):
        fm = generate_skill_frontmatter("Test", "A test skill")
        self.assertIn("name: Test", fm)
        self.assertIn('description: "A test skill"', fm)
        self.assertIn("source: auto-generated", fm)
        self.assertIn("times_used: 0", fm)
        self.assertIn("confidence: 0.50", fm)

    def test_custom_confidence(self):
        fm = generate_skill_frontmatter("X", "Y", confidence=0.85)
        self.assertIn("confidence: 0.85", fm)

    def test_tags(self):
        fm = generate_skill_frontmatter("X", "Y", tags=["python", "deploy"])
        self.assertIn("tags: [python, deploy]", fm)

    def test_no_tags(self):
        fm = generate_skill_frontmatter("X", "Y")
        self.assertIn("tags: []", fm)


class TestSkillMd(unittest.TestCase):
    def test_all_sections_present(self):
        md = generate_skill_md(
            name="Deploy App",
            description="Deploy an application",
            trigger_conditions="When user asks to deploy",
            procedure="1. Build\n2. Deploy\n3. Verify",
            references="deploy.py, Dockerfile",
            task_description="deploying the web app",
        )
        self.assertIn("# Deploy App", md)
        self.assertIn("## When to Use", md)
        self.assertIn("## Procedure", md)
        self.assertIn("## References", md)
        self.assertIn("## History", md)
        self.assertIn("deploy.py, Dockerfile", md)
        self.assertIn("deploying the web app", md)

    def test_default_references(self):
        md = generate_skill_md(
            name="Test",
            description="Test",
            trigger_conditions="Always",
            procedure="Do it",
        )
        self.assertIn("None yet.", md)

    def test_tags_in_frontmatter(self):
        md = generate_skill_md(
            name="Tagged",
            description="Has tags",
            trigger_conditions="Tagged task",
            procedure="Follow tags",
            tags=["infra", "aws"],
        )
        self.assertIn("tags: [infra, aws]", md)


class TestHistoryEntry(unittest.TestCase):
    def test_format(self):
        entry = generate_history_entry("Updated procedure")
        self.assertTrue(entry.startswith("- "))
        self.assertIn("Updated procedure", entry)
        self.assertIn("202", entry)


class TestImprovementDiff(unittest.TestCase):
    def test_diff_format(self):
        diff = generate_improvement_diff(
            old_procedure="Old way",
            new_procedure="New way",
            reason="Faster",
        )
        self.assertIn("Old way", diff)
        self.assertIn("New way", diff)
        self.assertIn("Faster", diff)
        self.assertIn("Improvement", diff)


if __name__ == "__main__":
    unittest.main()
