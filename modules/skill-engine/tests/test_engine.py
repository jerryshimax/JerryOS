"""Tests for the core skill engine."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from engine import create_skill, detect_novelty, improve_skill, learn_from_session, make_skill_id, use_skill
from index import get_connection, get_skill


class TestMakeSkillId(unittest.TestCase):
    def test_basic(self):
        sid = make_skill_id("Deploy Next.js App")
        self.assertIn("deploy-next-js-app", sid)
        self.assertGreater(len(sid), 10)

    def test_deterministic(self):
        self.assertEqual(make_skill_id("foo"), make_skill_id("foo"))

    def test_different_names_different_ids(self):
        self.assertNotEqual(make_skill_id("foo"), make_skill_id("bar"))

    def test_special_characters(self):
        sid = make_skill_id("Fix bug #123 (urgent!)")
        self.assertNotIn(" ", sid)
        self.assertNotIn("#", sid)


class TestDetectNovelty(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.db_path = self.tmp_dir / "test.db"
        self.learned_dir = self.tmp_dir / "learned"

    def test_empty_db_is_novel(self):
        result = detect_novelty("deploy a nextjs app", db_path=self.db_path)
        self.assertTrue(result["is_novel"])
        self.assertEqual(result["matches"], [])
        self.assertIsNone(result["best_match"])

    def test_finds_existing_skill(self):
        create_skill(
            name="Deploy Next.js",
            description="Deploy a Next.js application",
            trigger_conditions="User asks to deploy Next.js",
            procedure="1. Build\n2. Deploy",
            confidence=0.7,
            tags=["nextjs", "deploy"],
            db_path=self.db_path,
            learned_dir=self.learned_dir,
        )
        result = detect_novelty("deploy next.js", db_path=self.db_path)
        self.assertGreater(len(result["matches"]), 0)


class TestCreateSkill(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.db_path = self.tmp_dir / "test.db"
        self.learned_dir = self.tmp_dir / "learned"

    def test_creates_file_and_indexes(self):
        result = create_skill(
            name="Test Skill",
            description="A test skill",
            trigger_conditions="When testing",
            procedure="1. Test it\n2. Verify",
            confidence=0.6,
            tags=["test"],
            db_path=self.db_path,
            learned_dir=self.learned_dir,
        )
        self.assertTrue(result["skill_id"])
        self.assertTrue(result["indexed"])
        file_path = Path(result["file_path"])
        self.assertTrue(file_path.exists())
        content = file_path.read_text()
        self.assertIn("Test Skill", content)
        self.assertIn("When testing", content)
        self.assertIn("confidence: 0.60", content)

    def test_skill_md_has_all_sections(self):
        result = create_skill(
            name="Full Sections Skill",
            description="Has all sections",
            trigger_conditions="Always",
            procedure="Step 1",
            references="file.py",
            task_description="testing sections",
            tags=["meta"],
            db_path=self.db_path,
            learned_dir=self.learned_dir,
        )
        content = Path(result["file_path"]).read_text()
        self.assertIn("## When to Use", content)
        self.assertIn("## Procedure", content)
        self.assertIn("## References", content)
        self.assertIn("## History", content)
        self.assertIn("testing sections", content)


class TestUseSkill(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.db_path = self.tmp_dir / "test.db"
        self.learned_dir = self.tmp_dir / "learned"

    def test_record_success(self):
        created = create_skill(
            name="Usable Skill",
            description="Track usage",
            trigger_conditions="When used",
            procedure="Do it",
            db_path=self.db_path,
            learned_dir=self.learned_dir,
        )
        sid = created["skill_id"]

        updated = use_skill(sid, succeeded=True, db_path=self.db_path)
        self.assertEqual(updated["times_used"], 1)
        self.assertEqual(updated["times_succeeded"], 1)

        updated = use_skill(sid, succeeded=True, db_path=self.db_path)
        self.assertEqual(updated["times_used"], 2)
        self.assertGreater(updated["confidence"], 0.5)

    def test_record_failure_decreases_confidence(self):
        created = create_skill(
            name="Failing Skill",
            description="Will fail",
            trigger_conditions="When failing",
            procedure="Fail",
            confidence=0.5,
            db_path=self.db_path,
            learned_dir=self.learned_dir,
        )
        sid = created["skill_id"]

        for _ in range(5):
            use_skill(sid, succeeded=False, db_path=self.db_path)

        conn = get_connection(self.db_path)
        skill = get_skill(conn, sid)
        conn.close()
        self.assertLess(skill["confidence"], 0.5)

    def test_nonexistent_skill(self):
        result = use_skill("nonexistent", db_path=self.db_path)
        self.assertIsNone(result)


class TestImproveSkill(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.db_path = self.tmp_dir / "test.db"
        self.learned_dir = self.tmp_dir / "learned"

    def test_updates_procedure(self):
        created = create_skill(
            name="Improvable",
            description="Can be improved",
            trigger_conditions="When improving",
            procedure="Old approach",
            db_path=self.db_path,
            learned_dir=self.learned_dir,
        )
        sid = created["skill_id"]

        result = improve_skill(
            sid, new_procedure="New better approach", reason="Found faster method",
            db_path=self.db_path,
        )
        self.assertIsNotNone(result)

        content = Path(created["file_path"]).read_text()
        self.assertIn("New better approach", content)
        self.assertIn("Found faster method", content)

    def test_nonexistent_skill(self):
        result = improve_skill("nope", "new", "reason", db_path=self.db_path)
        self.assertIsNone(result)


class TestLearnFromSession(unittest.TestCase):
    def test_skips_failed_session(self):
        result = learn_from_session({"task": "something", "success": False})
        self.assertEqual(result["action"], "skipped")

    def test_skips_missing_fields(self):
        result = learn_from_session({
            "task": "something",
            "success": True,
            "name": "Test",
        })
        self.assertEqual(result["action"], "skipped")
        self.assertIn("Missing fields", result["reason"])


if __name__ == "__main__":
    unittest.main()
