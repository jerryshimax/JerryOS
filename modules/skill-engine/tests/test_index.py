"""Tests for the SQLite FTS5 skill index."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from index import (
    add_skill,
    delete_skill,
    get_connection,
    get_skill,
    get_stats,
    list_skills,
    prune_skills,
    record_usage,
    search_skills,
    update_skill_procedure,
)


class IndexTestCase(unittest.TestCase):
    """Base class with a fresh DB connection per test."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.db_path = Path(self.tmp_dir) / "test.db"
        self.conn = get_connection(self.db_path)

    def tearDown(self):
        self.conn.close()

    def _populate(self):
        """Add sample skills."""
        skills = [
            ("deploy-nextjs", "Deploy Next.js", "Deploy a Next.js application to Vercel",
             "/tmp/s1.md", 0.8, ["nextjs", "vercel", "deploy"], "deploy nextjs", "1. build 2. deploy"),
            ("setup-postgres", "Setup PostgreSQL", "Initialize PostgreSQL with migrations",
             "/tmp/s2.md", 0.6, ["postgres", "database"], "setup db", "1. install 2. migrate"),
            ("fix-cors", "Fix CORS Issues", "Debug and fix CORS configuration",
             "/tmp/s3.md", 0.3, ["cors", "api", "debug"], "cors errors", "1. check headers"),
        ]
        for sid, name, desc, path, conf, tags, trigger, proc in skills:
            add_skill(self.conn, sid, name, desc, path, conf, tags, trigger, proc)


class TestConnection(IndexTestCase):
    def test_creates_tables(self):
        tables = self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        table_names = {t["name"] for t in tables}
        self.assertIn("skills", table_names)
        self.assertIn("skills_fts", table_names)

    def test_idempotent_creation(self):
        db2 = Path(self.tmp_dir) / "test2.db"
        c1 = get_connection(db2)
        c1.close()
        c2 = get_connection(db2)
        c2.close()


class TestAddAndGet(IndexTestCase):
    def test_add_and_get(self):
        add_skill(self.conn, "test-1", "Test Skill", "A test", "/tmp/t.md", 0.5,
                  ["test"], "when testing", "do the test")
        skill = get_skill(self.conn, "test-1")
        self.assertIsNotNone(skill)
        self.assertEqual(skill["name"], "Test Skill")
        self.assertEqual(skill["confidence"], 0.5)
        self.assertEqual(skill["times_used"], 0)

    def test_get_nonexistent(self):
        self.assertIsNone(get_skill(self.conn, "nope"))

    def test_upsert(self):
        add_skill(self.conn, "dup", "V1", "First", "/tmp/v1.md", 0.5)
        add_skill(self.conn, "dup", "V2", "Second", "/tmp/v2.md", 0.9)
        skill = get_skill(self.conn, "dup")
        self.assertEqual(skill["name"], "V2")
        self.assertEqual(skill["confidence"], 0.9)


class TestSearch(IndexTestCase):
    def setUp(self):
        super().setUp()
        self._populate()

    def test_fts_search(self):
        results = search_skills(self.conn, "deploy nextjs")
        self.assertGreater(len(results), 0)
        self.assertTrue(any("Next.js" in r["name"] for r in results))

    def test_search_by_tag(self):
        results = search_skills(self.conn, "database")
        self.assertGreater(len(results), 0)

    def test_search_no_results(self):
        results = search_skills(self.conn, "xyznonexistent")
        self.assertEqual(len(results), 0)

    def test_search_limit(self):
        results = search_skills(self.conn, "deploy", limit=1)
        self.assertLessEqual(len(results), 1)


class TestListSkills(IndexTestCase):
    def setUp(self):
        super().setUp()
        self._populate()

    def test_list_all(self):
        skills = list_skills(self.conn)
        self.assertEqual(len(skills), 3)

    def test_list_sorted_by_confidence(self):
        skills = list_skills(self.conn, order_by="confidence DESC")
        confs = [s["confidence"] for s in skills]
        self.assertEqual(confs, sorted(confs, reverse=True))

    def test_list_limit(self):
        skills = list_skills(self.conn, limit=1)
        self.assertEqual(len(skills), 1)

    def test_invalid_order_by_falls_back(self):
        skills = list_skills(self.conn, order_by="DROP TABLE skills; --")
        self.assertEqual(len(skills), 3)


class TestRecordUsage(IndexTestCase):
    def setUp(self):
        super().setUp()
        self._populate()

    def test_increments_usage(self):
        record_usage(self.conn, "deploy-nextjs", succeeded=True)
        skill = get_skill(self.conn, "deploy-nextjs")
        self.assertEqual(skill["times_used"], 1)
        self.assertEqual(skill["times_succeeded"], 1)
        self.assertIsNotNone(skill["last_used"])

    def test_multiple_successes_increase_confidence(self):
        for _ in range(10):
            record_usage(self.conn, "fix-cors", succeeded=True)
        skill = get_skill(self.conn, "fix-cors")
        self.assertEqual(skill["times_used"], 10)
        self.assertGreater(skill["confidence"], 0.3)

    def test_failures_decrease_confidence(self):
        for _ in range(10):
            record_usage(self.conn, "deploy-nextjs", succeeded=False)
        skill = get_skill(self.conn, "deploy-nextjs")
        self.assertLess(skill["confidence"], 0.5)


class TestUpdateProcedure(IndexTestCase):
    def setUp(self):
        super().setUp()
        self._populate()

    def test_updates_procedure(self):
        update_skill_procedure(self.conn, "deploy-nextjs", "New procedure here")
        skill = get_skill(self.conn, "deploy-nextjs")
        self.assertEqual(skill["procedure"], "New procedure here")


class TestDeleteSkill(IndexTestCase):
    def setUp(self):
        super().setUp()
        self._populate()

    def test_delete_existing(self):
        self.assertTrue(delete_skill(self.conn, "fix-cors"))
        self.assertIsNone(get_skill(self.conn, "fix-cors"))

    def test_delete_nonexistent(self):
        self.assertFalse(delete_skill(self.conn, "nope"))


class TestStats(IndexTestCase):
    def test_stats_populated(self):
        self._populate()
        s = get_stats(self.conn)
        self.assertEqual(s["total_skills"], 3)
        self.assertIsNotNone(s["avg_confidence"])

    def test_stats_empty(self):
        s = get_stats(self.conn)
        self.assertEqual(s["total_skills"], 0)


class TestPrune(IndexTestCase):
    def setUp(self):
        super().setUp()
        self._populate()

    def test_prune_low_confidence(self):
        deleted = prune_skills(self.conn, below_confidence=0.31)
        self.assertIn("fix-cors", deleted)
        self.assertIsNone(get_skill(self.conn, "fix-cors"))
        self.assertIsNotNone(get_skill(self.conn, "deploy-nextjs"))

    def test_prune_nothing(self):
        deleted = prune_skills(self.conn, below_confidence=0.1)
        self.assertEqual(len(deleted), 0)


if __name__ == "__main__":
    unittest.main()
