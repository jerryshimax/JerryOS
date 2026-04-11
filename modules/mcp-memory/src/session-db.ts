/**
 * Session Database — SQLite FTS5-backed session storage.
 *
 * Stores conversation sessions with full-text search via FTS5.
 * Database lives at ~/Ship/mcp-memory/sessions.db
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";

const DB_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "sessions.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      entity TEXT,
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      tool_input TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);

  // Create FTS5 virtual table if it doesn't exist
  // We use a separate check because CREATE VIRTUAL TABLE IF NOT EXISTS is not supported by FTS5
  const ftsExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'")
    .get();

  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        content,
        tool_name,
        content=messages,
        content_rowid=id
      );

      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content, tool_name) VALUES (new.id, new.content, new.tool_name);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, tool_name) VALUES ('delete', old.id, old.content, old.tool_name);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, tool_name) VALUES ('delete', old.id, old.content, old.tool_name);
        INSERT INTO messages_fts(rowid, content, tool_name) VALUES (new.id, new.content, new.tool_name);
      END;
    `);
  }

  // Create index on session_id for fast joins
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_entity ON sessions(entity);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
  `);

  return db;
}

// --- Types ---

export interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  entity: string | null;
  summary: string | null;
}

export interface MessageRow {
  id: number;
  session_id: string;
  timestamp: string;
  role: string;
  content: string;
  tool_name: string | null;
  tool_input: string | null;
}

export interface SearchHit {
  message_id: number;
  session_id: string;
  timestamp: string;
  role: string;
  content: string;
  tool_name: string | null;
  rank: number;
  session_entity: string | null;
  session_started: string;
}

export interface SessionSummaryData {
  session_id: string;
  started_at: string;
  ended_at: string | null;
  entity: string | null;
  summary: string | null;
  first_message: string;
  message_count: number;
  tool_calls: string[];
  last_message: string;
  duration_minutes: number | null;
}

export interface SessionStatsData {
  total_sessions: number;
  total_messages: number;
  by_entity: Record<string, number>;
  by_date: { date: string; count: number }[];
  top_tools: { tool: string; count: number }[];
  recent_sessions: { id: string; started_at: string; entity: string | null; message_count: number }[];
}

// --- Session CRUD ---

export function createSession(id: string, startedAt: string, entity?: string): void {
  const d = getDb();
  d.prepare("INSERT OR IGNORE INTO sessions (id, started_at, entity) VALUES (?, ?, ?)").run(
    id,
    startedAt,
    entity || null
  );
}

export function updateSession(id: string, updates: { ended_at?: string; entity?: string; summary?: string }): void {
  const d = getDb();
  const parts: string[] = [];
  const vals: (string | null)[] = [];

  if (updates.ended_at !== undefined) {
    parts.push("ended_at = ?");
    vals.push(updates.ended_at);
  }
  if (updates.entity !== undefined) {
    parts.push("entity = ?");
    vals.push(updates.entity);
  }
  if (updates.summary !== undefined) {
    parts.push("summary = ?");
    vals.push(updates.summary);
  }

  if (parts.length === 0) return;
  vals.push(id);
  d.prepare(`UPDATE sessions SET ${parts.join(", ")} WHERE id = ?`).run(...vals);
}

export function insertMessage(
  sessionId: string,
  timestamp: string,
  role: string,
  content: string,
  toolName?: string,
  toolInput?: string
): number {
  const d = getDb();
  const result = d
    .prepare(
      "INSERT INTO messages (session_id, timestamp, role, content, tool_name, tool_input) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(sessionId, timestamp, role, content, toolName || null, toolInput || null);
  return Number(result.lastInsertRowid);
}

// --- Search ---

export function searchSessions(
  query: string,
  options: {
    entity?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
  } = {}
): SearchHit[] {
  const d = getDb();
  const { entity, date_from, date_to, limit = 10 } = options;

  let sql = `
    SELECT
      m.id as message_id,
      m.session_id,
      m.timestamp,
      m.role,
      m.content,
      m.tool_name,
      rank,
      s.entity as session_entity,
      s.started_at as session_started
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.rowid
    JOIN sessions s ON s.id = m.session_id
    WHERE messages_fts MATCH ?
  `;

  const params: (string | number)[] = [query];

  if (entity) {
    sql += " AND s.entity = ?";
    params.push(entity);
  }
  if (date_from) {
    sql += " AND m.timestamp >= ?";
    params.push(date_from);
  }
  if (date_to) {
    sql += " AND m.timestamp <= ?";
    params.push(date_to);
  }

  sql += " ORDER BY rank LIMIT ?";
  params.push(limit);

  return d.prepare(sql).all(...params) as SearchHit[];
}

// --- Recall ---

export function recallSession(sessionId: string): { session: SessionRow; messages: MessageRow[] } | null {
  const d = getDb();
  const session = d.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
  if (!session) return null;

  const messages = d
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC, id ASC")
    .all(sessionId) as MessageRow[];

  return { session, messages };
}

// --- Summary ---

export function getSessionSummaries(
  query: string,
  limit: number = 5
): SessionSummaryData[] {
  const d = getDb();

  // Find matching session IDs via FTS, grouped by session
  const matchingSessions = d
    .prepare(
      `
      SELECT DISTINCT m.session_id
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `
    )
    .all(query, limit * 2) as { session_id: string }[]; // fetch extra to account for dedup

  const seen = new Set<string>();
  const results: SessionSummaryData[] = [];

  for (const { session_id } of matchingSessions) {
    if (seen.has(session_id) || results.length >= limit) continue;
    seen.add(session_id);

    const session = d.prepare("SELECT * FROM sessions WHERE id = ?").get(session_id) as SessionRow | undefined;
    if (!session) continue;

    const messages = d
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC, id ASC")
      .all(session_id) as MessageRow[];

    if (messages.length === 0) continue;

    const toolCalls = messages
      .filter((m) => m.tool_name)
      .map((m) => m.tool_name!)
      .filter((v, i, a) => a.indexOf(v) === i); // unique

    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];

    let durationMinutes: number | null = null;
    if (session.ended_at && session.started_at) {
      const start = new Date(session.started_at).getTime();
      const end = new Date(session.ended_at).getTime();
      if (!isNaN(start) && !isNaN(end)) {
        durationMinutes = Math.round((end - start) / 60000);
      }
    }

    results.push({
      session_id: session.id,
      started_at: session.started_at,
      ended_at: session.ended_at,
      entity: session.entity,
      summary: session.summary,
      first_message: firstMsg.content.slice(0, 500),
      message_count: messages.length,
      tool_calls: toolCalls,
      last_message: lastMsg.content.slice(0, 500),
      duration_minutes: durationMinutes,
    });
  }

  return results;
}

export function getRecentSessionSummaries(
  limit: number = 5,
  entity?: string
): SessionSummaryData[] {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT id
       FROM sessions
       ${entity ? "WHERE entity = ?" : ""}
       ORDER BY started_at DESC
       LIMIT ?`
    )
    .all(...(entity ? [entity, limit] : [limit])) as { id: string }[];

  const results: SessionSummaryData[] = [];

  for (const row of rows) {
    const session = d.prepare("SELECT * FROM sessions WHERE id = ?").get(row.id) as SessionRow | undefined;
    if (!session) continue;

    const messages = d
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC, id ASC")
      .all(row.id) as MessageRow[];

    if (messages.length === 0) continue;

    const toolCalls = messages
      .filter((message) => message.tool_name)
      .map((message) => message.tool_name!)
      .filter((value, index, all) => all.indexOf(value) === index);

    let durationMinutes: number | null = null;
    if (session.ended_at) {
      const start = new Date(session.started_at).getTime();
      const end = new Date(session.ended_at).getTime();
      if (!isNaN(start) && !isNaN(end)) {
        durationMinutes = Math.round((end - start) / 60000);
      }
    }

    results.push({
      session_id: session.id,
      started_at: session.started_at,
      ended_at: session.ended_at,
      entity: session.entity,
      summary: session.summary,
      first_message: messages[0].content.slice(0, 500),
      message_count: messages.length,
      tool_calls: toolCalls,
      last_message: messages[messages.length - 1].content.slice(0, 500),
      duration_minutes: durationMinutes,
    });
  }

  return results;
}

// --- Ingest JSONL ---

export function ingestSessionFile(filePath: string): { sessions: number; messages: number } {
  const d = getDb();
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());

  let sessionCount = 0;
  let messageCount = 0;

  const insertSessionStmt = d.prepare(
    "INSERT OR IGNORE INTO sessions (id, started_at, ended_at, entity, summary) VALUES (?, ?, ?, ?, ?)"
  );
  const insertMessageStmt = d.prepare(
    "INSERT INTO messages (session_id, timestamp, role, content, tool_name, tool_input) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const dedupeMessageStmt = d.prepare(
    `SELECT 1
     FROM messages
     WHERE session_id = ?
       AND timestamp = ?
       AND role = ?
       AND content = ?
       AND COALESCE(tool_name, '') = COALESCE(?, '')
     LIMIT 1`
  );

  const transaction = d.transaction(() => {
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        if (entry.type === "session" || entry.session_id && entry.started_at && !entry.role) {
          // Session header
          const result = insertSessionStmt.run(
            entry.session_id || entry.id,
            entry.started_at,
            entry.ended_at || null,
            entry.entity || null,
            entry.summary || null
          );
          if (result.changes > 0) sessionCount++;
        } else if (entry.role && entry.content !== undefined) {
          // Message entry
          const sessionId = entry.session_id;
          if (!sessionId) continue;
          const timestamp = entry.timestamp || new Date().toISOString();
          const role = entry.role;
          const content =
            typeof entry.content === "string"
              ? entry.content
              : JSON.stringify(entry.content);
          const toolName = entry.tool_name || entry.tool_calls_summary || null;

          // Ensure session exists
          insertSessionStmt.run(
            sessionId,
            timestamp,
            null,
            entry.entity || null,
            null
          );

          const exists = dedupeMessageStmt.get(
            sessionId,
            timestamp,
            role,
            content,
            toolName
          );
          if (exists) continue;

          insertMessageStmt.run(
            sessionId,
            timestamp,
            role,
            content,
            toolName,
            entry.tool_input ? JSON.stringify(entry.tool_input) : null
          );
          messageCount++;
        }
      } catch (err) {
        // Skip malformed lines
        console.error(`Skipping malformed JSONL line: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  transaction();

  return { sessions: sessionCount, messages: messageCount };
}

// --- Stats ---

export function getSessionStats(): SessionStatsData {
  const d = getDb();

  const totalSessions = (d.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c;
  const totalMessages = (d.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c;

  // By entity
  const entityRows = d
    .prepare("SELECT COALESCE(entity, 'untagged') as entity, COUNT(*) as c FROM sessions GROUP BY entity ORDER BY c DESC")
    .all() as { entity: string; c: number }[];
  const byEntity: Record<string, number> = {};
  for (const row of entityRows) {
    byEntity[row.entity] = row.c;
  }

  // By date (last 30 days)
  const dateRows = d
    .prepare(
      `SELECT DATE(started_at) as date, COUNT(*) as count
       FROM sessions
       WHERE started_at >= DATE('now', '-30 days')
       GROUP BY DATE(started_at)
       ORDER BY date DESC`
    )
    .all() as { date: string; count: number }[];

  // Top tools
  const toolRows = d
    .prepare(
      `SELECT tool_name as tool, COUNT(*) as count
       FROM messages
       WHERE tool_name IS NOT NULL
       GROUP BY tool_name
       ORDER BY count DESC
       LIMIT 20`
    )
    .all() as { tool: string; count: number }[];

  // Recent sessions
  const recentRows = d
    .prepare(
      `SELECT s.id, s.started_at, s.entity,
              (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count
       FROM sessions s
       ORDER BY s.started_at DESC
       LIMIT 10`
    )
    .all() as { id: string; started_at: string; entity: string | null; message_count: number }[];

  return {
    total_sessions: totalSessions,
    total_messages: totalMessages,
    by_entity: byEntity,
    by_date: dateRows,
    top_tools: toolRows,
    recent_sessions: recentRows,
  };
}

// --- Cleanup ---

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
