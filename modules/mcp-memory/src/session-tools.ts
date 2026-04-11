/**
 * Session Tools — MCP tool definitions for session search, recall, summary, ingest, and stats.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  searchSessions,
  recallSession,
  getSessionSummaries,
  ingestSessionFile,
  getSessionStats,
} from "./session-db.js";

export function registerSessionTools(server: McpServer): void {
  // --- session_search ---
  server.tool(
    "session_search",
    "FTS5 full-text search across all past conversation sessions. Returns matching excerpts with timestamps and entity tags, ranked by relevance.",
    {
      query: z.string().describe("Full-text search query (supports FTS5 syntax: AND, OR, NOT, quotes for phrases)"),
      entity: z
        .enum(["SYN", "CE", "UUL"])
        .optional()
        .describe("Filter by entity tag"),
      date_from: z
        .string()
        .optional()
        .describe("Start date filter (ISO 8601, e.g. 2026-03-01)"),
      date_to: z
        .string()
        .optional()
        .describe("End date filter (ISO 8601, e.g. 2026-03-31)"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Max results (default 10)"),
    },
    async ({ query, entity, date_from, date_to, limit }) => {
      try {
        const hits = searchSessions(query, { entity, date_from, date_to, limit });

        if (hits.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No session results for "${query}". Try broader terms or remove filters.`,
              },
            ],
          };
        }

        const formatted = hits
          .map((h, i) => {
            const entityStr = h.session_entity ? ` [${h.session_entity}]` : "";
            const toolStr = h.tool_name ? ` (tool: ${h.tool_name})` : "";
            const snippet = h.content.length > 300 ? h.content.slice(0, 297) + "..." : h.content;
            return [
              `${i + 1}. Session: ${h.session_id}${entityStr}`,
              `   Time: ${h.timestamp} | Role: ${h.role}${toolStr}`,
              `   ${snippet.replace(/\n/g, " ").trim()}`,
            ].join("\n");
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `${hits.length} result(s) for "${query}":\n\n${formatted}`,
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Session search error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // --- session_recall ---
  server.tool(
    "session_recall",
    "Retrieve the full conversation for a given session ID. Returns all messages with roles, timestamps, and tool calls.",
    {
      session_id: z.string().describe("Session ID to recall"),
    },
    async ({ session_id }) => {
      try {
        const result = recallSession(session_id);
        if (!result) {
          return {
            content: [{ type: "text", text: `Session not found: ${session_id}` }],
          };
        }

        const { session, messages } = result;
        const header = [
          `Session: ${session.id}`,
          `Started: ${session.started_at}`,
          session.ended_at ? `Ended: ${session.ended_at}` : null,
          session.entity ? `Entity: ${session.entity}` : null,
          session.summary ? `Summary: ${session.summary}` : null,
          `Messages: ${messages.length}`,
          `---`,
        ]
          .filter(Boolean)
          .join("\n");

        const formatted = messages
          .map((m) => {
            const toolStr = m.tool_name ? ` [tool: ${m.tool_name}]` : "";
            return `[${m.timestamp}] ${m.role}${toolStr}:\n${m.content}`;
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `${header}\n\n${formatted}`,
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Session recall error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // --- session_summary ---
  server.tool(
    "session_summary",
    "Get structured summaries of sessions matching a query. Returns first message, key tool calls, final outcome, entity tags, and duration for each match.",
    {
      query: z.string().describe("Full-text search query to find relevant sessions"),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe("Max sessions to summarize (default 5)"),
    },
    async ({ query, limit }) => {
      try {
        const summaries = getSessionSummaries(query, limit);

        if (summaries.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No sessions match "${query}".`,
              },
            ],
          };
        }

        const formatted = summaries
          .map((s, i) => {
            const entityStr = s.entity ? ` [${s.entity}]` : "";
            const durationStr =
              s.duration_minutes !== null ? ` | Duration: ${s.duration_minutes}m` : "";
            const toolStr =
              s.tool_calls.length > 0 ? `\n   Tools: ${s.tool_calls.join(", ")}` : "";

            return [
              `${i + 1}. ${s.session_id}${entityStr}`,
              `   Started: ${s.started_at}${durationStr} | Messages: ${s.message_count}`,
              s.summary ? `   Summary: ${s.summary}` : null,
              `   First: ${s.first_message.replace(/\n/g, " ").trim().slice(0, 200)}`,
              `   Last: ${s.last_message.replace(/\n/g, " ").trim().slice(0, 200)}`,
              toolStr || null,
            ]
              .filter(Boolean)
              .join("\n");
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `${summaries.length} session(s) matching "${query}":\n\n${formatted}`,
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Session summary error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // --- session_ingest ---
  server.tool(
    "session_ingest",
    "Ingest a session log file (JSONL format) into the session database. Each line should be a JSON object with session headers and/or messages.",
    {
      file_path: z
        .string()
        .describe(
          "Absolute path to JSONL session file. Each line: {session_id, role, content, timestamp, ...}"
        ),
    },
    async ({ file_path }) => {
      try {
        const result = ingestSessionFile(file_path);
        return {
          content: [
            {
              type: "text",
              text: `Ingested ${result.sessions} session(s) and ${result.messages} message(s) from ${file_path}`,
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Ingest error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // --- session_stats ---
  server.tool(
    "session_stats",
    "Usage statistics for the session database: total sessions, sessions by entity, by date, most frequent tools, and recent sessions.",
    {},
    async () => {
      try {
        const stats = getSessionStats();

        const lines = [
          `**Session Database Stats**`,
          `Total sessions: ${stats.total_sessions}`,
          `Total messages: ${stats.total_messages}`,
          ``,
          `By entity:`,
          ...Object.entries(stats.by_entity).map(([k, v]) => `  ${k}: ${v}`),
          ``,
          `Recent activity (last 30 days):`,
          ...stats.by_date.map((d) => `  ${d.date}: ${d.count} session(s)`),
        ];

        if (stats.top_tools.length > 0) {
          lines.push(``, `Top tools used:`);
          for (const t of stats.top_tools.slice(0, 10)) {
            lines.push(`  ${t.tool}: ${t.count}`);
          }
        }

        if (stats.recent_sessions.length > 0) {
          lines.push(``, `Recent sessions:`);
          for (const s of stats.recent_sessions) {
            const entityStr = s.entity ? ` [${s.entity}]` : "";
            lines.push(`  ${s.started_at}${entityStr} — ${s.message_count} msgs (${s.id})`);
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Session stats error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
