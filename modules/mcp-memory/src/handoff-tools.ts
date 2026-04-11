import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import {
  getLatestHandoff,
  listRecentHandoffs,
  searchHandoffText,
  upsertHandoff,
  type HandoffSnapshot,
} from "./handoff-store.js";

function formatSnapshot(snapshot: HandoffSnapshot): string {
  const lines = [
    `ID: ${snapshot.id}`,
    `Updated: ${snapshot.updated_at}`,
    `Agent: ${snapshot.source_agent}`,
    `Scope: ${snapshot.scope}`,
    snapshot.project_root ? `Project: ${snapshot.project_root}` : null,
    snapshot.entity ? `Entity: ${snapshot.entity}` : null,
    `Status: ${snapshot.status}`,
    `Title: ${snapshot.title}`,
    snapshot.summary ? `Summary: ${snapshot.summary}` : null,
    snapshot.last_completed_step
      ? `Last completed: ${snapshot.last_completed_step}`
      : null,
    snapshot.next_step ? `Next step: ${snapshot.next_step}` : null,
    snapshot.blockers.length > 0
      ? `Blockers: ${snapshot.blockers.join(" | ")}`
      : null,
    snapshot.decisions.length > 0
      ? `Decisions: ${snapshot.decisions.join(" | ")}`
      : null,
    snapshot.touched_paths.length > 0
      ? `Touched paths: ${snapshot.touched_paths.join(", ")}`
      : null,
    snapshot.related_contacts.length > 0
      ? `Related contacts: ${snapshot.related_contacts.join(", ")}`
      : null,
  ].filter(Boolean);

  return lines.join("\n");
}

export function registerHandoffTools(server: McpServer): void {
  server.tool(
    "handoff_get_latest",
    "Get the latest structured handoff snapshot, optionally scoped to a project.",
    {
      project_root: z.string().optional().describe("Project root to prefer"),
      scope: z.enum(["global", "project"]).optional(),
    },
    async ({ project_root, scope }) => {
      try {
        const snapshot = getLatestHandoff(project_root, scope);
        return {
          content: [
            {
              type: "text",
              text: snapshot ? formatSnapshot(snapshot) : "No handoff snapshot found.",
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Handoff error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "handoff_list_recent",
    "List recent structured handoff snapshots.",
    {
      limit: z.number().optional().default(10),
      project_root: z.string().optional(),
    },
    async ({ limit, project_root }) => {
      try {
        const snapshots = listRecentHandoffs(limit, project_root);
        if (snapshots.length === 0) {
          return {
            content: [{ type: "text", text: "No recent handoffs found." }],
          };
        }

        const text = snapshots
          .map(
            (snapshot, index) =>
              `${index + 1}. ${snapshot.updated_at} | ${snapshot.source_agent} | ${snapshot.title}`
          )
          .join("\n");
        return { content: [{ type: "text", text }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Handoff list error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "handoff_search",
    "Search structured handoff snapshots by title, summary, decisions, blockers, contacts, and tags.",
    {
      query: z.string(),
      limit: z.number().optional().default(10),
    },
    async ({ query, limit }) => {
      try {
        const hits = searchHandoffText(query, limit);
        if (hits.length === 0) {
          return {
            content: [{ type: "text", text: `No handoff results for "${query}".` }],
          };
        }

        const text = hits
          .map(
            (hit, index) =>
              `${index + 1}. ${hit.snapshot.title} | score=${hit.score} | matched=${hit.matched_fields.join(", ") || "text"}`
          )
          .join("\n");
        return { content: [{ type: "text", text }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Handoff search error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "handoff_ingest",
    "Ingest a handoff snapshot JSON or JSONL file into the structured handoff store.",
    {
      file_path: z.string().describe("Absolute path to a JSON or JSONL handoff file"),
    },
    async ({ file_path }) => {
      try {
        const raw = fs.readFileSync(file_path, "utf-8");
        const entries = file_path.endsWith(".jsonl")
          ? raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line))
          : [JSON.parse(raw)];

        const written = entries.map((entry) =>
          upsertHandoff(entry as Partial<HandoffSnapshot>)
        );

        return {
          content: [
            {
              type: "text",
              text: `Ingested ${written.length} handoff snapshot(s) from ${file_path}`,
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Handoff ingest error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
