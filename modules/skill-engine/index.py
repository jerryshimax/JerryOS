"""SQLite FTS5-based skill index for searching and managing learned skills."""

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

from config import DB_PATH, LEARNED_DIR


def get_connection(db_path: Optional[Path] = None) -> sqlite3.Connection:
    """Get a database connection, creating tables if needed."""
    path = db_path or DB_PATH
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    _ensure_tables(conn)
    return conn


def _ensure_tables(conn: sqlite3.Connection) -> None:
    """Create tables and FTS index if they don't exist."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS skills (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            file_path TEXT NOT NULL,
            confidence REAL DEFAULT 0.5,
            times_used INTEGER DEFAULT 0,
            times_succeeded INTEGER DEFAULT 0,
            last_used TEXT,
            created TEXT NOT NULL,
            tags TEXT DEFAULT '[]',
            trigger_conditions TEXT DEFAULT '',
            procedure TEXT DEFAULT ''
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
            id,
            name,
            description,
            tags,
            trigger_conditions,
            procedure,
            content='skills',
            content_rowid='rowid'
        );

        CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
            INSERT INTO skills_fts(rowid, id, name, description, tags, trigger_conditions, procedure)
            VALUES (new.rowid, new.id, new.name, new.description, new.tags, new.trigger_conditions, new.procedure);
        END;

        CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
            INSERT INTO skills_fts(skills_fts, rowid, id, name, description, tags, trigger_conditions, procedure)
            VALUES ('delete', old.rowid, old.id, old.name, old.description, old.tags, old.trigger_conditions, old.procedure);
        END;

        CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
            INSERT INTO skills_fts(skills_fts, rowid, id, name, description, tags, trigger_conditions, procedure)
            VALUES ('delete', old.rowid, old.id, old.name, old.description, old.tags, old.trigger_conditions, old.procedure);
            INSERT INTO skills_fts(rowid, id, name, description, tags, trigger_conditions, procedure)
            VALUES (new.rowid, new.id, new.name, new.description, new.tags, new.trigger_conditions, new.procedure);
        END;
    """)
    conn.commit()


def add_skill(
    conn: sqlite3.Connection,
    skill_id: str,
    name: str,
    description: str,
    file_path: str,
    confidence: float = 0.5,
    tags: Optional[list[str]] = None,
    trigger_conditions: str = "",
    procedure: str = "",
) -> None:
    """Add a new skill to the index."""
    now = datetime.now().strftime("%Y-%m-%d")
    tags_json = json.dumps(tags or [])
    conn.execute(
        """INSERT OR REPLACE INTO skills
           (id, name, description, file_path, confidence, times_used, times_succeeded,
            last_used, created, tags, trigger_conditions, procedure)
           VALUES (?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?)""",
        (skill_id, name, description, file_path, confidence, now, tags_json,
         trigger_conditions, procedure),
    )
    conn.commit()


def search_skills(
    conn: sqlite3.Connection,
    query: str,
    limit: int = 10,
) -> list[dict]:
    """Full-text search across all skill fields."""
    # FTS5 query — escape special characters for safety
    safe_query = query.replace('"', '""')
    rows = conn.execute(
        """SELECT s.*, rank
           FROM skills_fts fts
           JOIN skills s ON s.id = fts.id
           WHERE skills_fts MATCH ?
           ORDER BY rank
           LIMIT ?""",
        (f'"{safe_query}"', limit),
    ).fetchall()
    return [dict(r) for r in rows]


def get_skill(conn: sqlite3.Connection, skill_id: str) -> Optional[dict]:
    """Get a skill by ID."""
    row = conn.execute(
        "SELECT * FROM skills WHERE id = ?", (skill_id,)
    ).fetchone()
    return dict(row) if row else None


def list_skills(
    conn: sqlite3.Connection,
    order_by: str = "confidence DESC",
    limit: int = 100,
) -> list[dict]:
    """List all skills, ordered by confidence by default."""
    # Whitelist allowed order_by values to prevent SQL injection
    allowed = {
        "confidence DESC", "confidence ASC",
        "times_used DESC", "times_used ASC",
        "created DESC", "created ASC",
        "name ASC", "name DESC",
        "last_used DESC",
    }
    if order_by not in allowed:
        order_by = "confidence DESC"
    rows = conn.execute(
        f"SELECT * FROM skills ORDER BY {order_by} LIMIT ?", (limit,)
    ).fetchall()
    return [dict(r) for r in rows]


def record_usage(
    conn: sqlite3.Connection,
    skill_id: str,
    succeeded: bool = True,
) -> None:
    """Record that a skill was used and whether it succeeded."""
    now = datetime.now().strftime("%Y-%m-%d")
    conn.execute(
        """UPDATE skills SET
           times_used = times_used + 1,
           times_succeeded = times_succeeded + ?,
           last_used = ?
           WHERE id = ?""",
        (1 if succeeded else 0, now, skill_id),
    )
    # Recalculate confidence from success rate
    row = conn.execute(
        "SELECT times_used, times_succeeded FROM skills WHERE id = ?",
        (skill_id,),
    ).fetchone()
    if row and row["times_used"] > 0:
        success_rate = row["times_succeeded"] / row["times_used"]
        # Blend: start at 0.5, converge toward actual success rate
        weight = min(row["times_used"] / 10.0, 1.0)
        new_confidence = (1 - weight) * 0.5 + weight * success_rate
        new_confidence = max(0.0, min(1.0, new_confidence))
        conn.execute(
            "UPDATE skills SET confidence = ? WHERE id = ?",
            (round(new_confidence, 3), skill_id),
        )
    conn.commit()


def update_skill_procedure(
    conn: sqlite3.Connection,
    skill_id: str,
    new_procedure: str,
) -> None:
    """Update the procedure text for a skill."""
    conn.execute(
        "UPDATE skills SET procedure = ? WHERE id = ?",
        (new_procedure, skill_id),
    )
    conn.commit()


def delete_skill(conn: sqlite3.Connection, skill_id: str) -> bool:
    """Delete a skill from the index. Returns True if deleted."""
    cursor = conn.execute("DELETE FROM skills WHERE id = ?", (skill_id,))
    conn.commit()
    return cursor.rowcount > 0


def get_stats(conn: sqlite3.Connection) -> dict:
    """Get aggregate statistics about the skill index."""
    row = conn.execute("""
        SELECT
            COUNT(*) as total_skills,
            ROUND(AVG(confidence), 3) as avg_confidence,
            SUM(times_used) as total_uses,
            ROUND(AVG(CASE WHEN times_used > 0
                  THEN CAST(times_succeeded AS REAL) / times_used
                  ELSE NULL END), 3) as avg_success_rate,
            COUNT(CASE WHEN confidence < 0.3 THEN 1 END) as low_confidence_count,
            COUNT(CASE WHEN confidence >= 0.7 THEN 1 END) as high_confidence_count
        FROM skills
    """).fetchone()
    return dict(row)


def prune_skills(
    conn: sqlite3.Connection,
    below_confidence: float = 0.3,
) -> list[str]:
    """Delete skills below a confidence threshold. Returns deleted IDs."""
    rows = conn.execute(
        "SELECT id, file_path FROM skills WHERE confidence < ?",
        (below_confidence,),
    ).fetchall()
    deleted_ids = []
    for row in rows:
        skill_id = row["id"]
        file_path = Path(row["file_path"])
        # Only delete files inside learned/
        if file_path.exists() and str(LEARNED_DIR) in str(file_path):
            file_path.unlink()
        conn.execute("DELETE FROM skills WHERE id = ?", (skill_id,))
        deleted_ids.append(skill_id)
    conn.commit()
    return deleted_ids
