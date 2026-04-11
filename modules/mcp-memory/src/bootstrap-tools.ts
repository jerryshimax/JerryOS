import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getLatestHandoff,
  type HandoffSnapshot,
} from "./handoff-store.js";
import {
  detectContactConflicts,
  findContact,
  type ContactRecord,
} from "./contact-store.js";
import { getRecentSessionSummaries, type SessionSummaryData } from "./session-db.js";

export interface BootstrapContext {
  generated_at: string;
  project_root: string | null;
  cwd: string | null;
  latest_handoff: HandoffSnapshot | null;
  recent_sessions: SessionSummaryData[];
  relevant_contacts: ContactRecord[];
  suggested_next_step: string | null;
  warnings: string[];
}

function uniqueContacts(records: ContactRecord[]): ContactRecord[] {
  const seen = new Set<string>();
  const result: ContactRecord[] = [];

  for (const record of records) {
    const key = `${record.source}:${record.file_path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }

  return result;
}

function inferProjectRoot(projectRoot?: string, cwd?: string): string | null {
  if (projectRoot && projectRoot.trim()) return projectRoot.trim();
  if (cwd && cwd.trim()) return cwd.trim();
  return null;
}

export function buildBootstrapContext(input: {
  project_root?: string;
  cwd?: string;
  entity?: "SYN" | "CE" | "UUL" | "FO";
  query?: string;
  limit?: number;
}): BootstrapContext {
  const projectRoot = inferProjectRoot(input.project_root, input.cwd);
  const latestHandoff =
    (projectRoot ? getLatestHandoff(projectRoot) : null) || getLatestHandoff();
  const recentSessions = getRecentSessionSummaries(
    input.limit || 5,
    input.entity
  );

  const contactQueries = [
    ...(latestHandoff?.related_contacts || []),
    input.query || "",
  ].filter(Boolean);
  const relevantContacts = uniqueContacts(
    contactQueries.flatMap((query) => findContact(query))
  );

  const warnings: string[] = [];
  if (!latestHandoff) {
    warnings.push("No handoff snapshot found. Context may be incomplete.");
  } else {
    const ageMs = Date.now() - new Date(latestHandoff.updated_at).getTime();
    if (ageMs > 1000 * 60 * 60 * 24) {
      warnings.push("Latest handoff snapshot is more than 24 hours old.");
    }
  }

  const conflicts = detectContactConflicts();
  if (conflicts.length > 0) {
    warnings.push(`${conflicts.length} contact alias conflict(s) detected.`);
  }

  return {
    generated_at: new Date().toISOString(),
    project_root: projectRoot,
    cwd: input.cwd || null,
    latest_handoff: latestHandoff,
    recent_sessions: recentSessions,
    relevant_contacts: relevantContacts,
    suggested_next_step: latestHandoff?.next_step || null,
    warnings,
  };
}

export function registerBootstrapTools(server: McpServer): void {
  server.tool(
    "context_bootstrap",
    "Build startup context for a fresh session. Returns the latest structured handoff, recent sessions, relevant contacts, and warnings.",
    {
      project_root: z.string().optional().describe("Preferred project root"),
      cwd: z.string().optional().describe("Current working directory"),
      entity: z.enum(["SYN", "CE", "UUL", "FO"]).optional(),
      query: z.string().optional().describe("Optional query for related contacts"),
      limit: z.number().optional().default(5).describe("Recent session limit"),
    },
    async ({ project_root, cwd, entity, query, limit }) => {
      try {
        const context = buildBootstrapContext({
          project_root,
          cwd,
          entity,
          query,
          limit,
        });

        const lines = [
          `Generated: ${context.generated_at}`,
          `Project root: ${context.project_root || "none"}`,
          context.latest_handoff
            ? `Latest handoff: ${context.latest_handoff.title} (${context.latest_handoff.updated_at})`
            : `Latest handoff: none`,
          context.suggested_next_step
            ? `Suggested next step: ${context.suggested_next_step}`
            : null,
          "",
          `Recent sessions: ${context.recent_sessions.length}`,
          ...context.recent_sessions.map(
            (session) =>
              `- ${session.session_id} | ${session.started_at} | ${session.entity || "untagged"}`
          ),
          "",
          `Relevant contacts: ${context.relevant_contacts.length}`,
          ...context.relevant_contacts.map(
            (contact) =>
              `- ${contact.canonical_name} [${contact.source}] ${contact.relationship_summary.slice(0, 140)}`
          ),
        ].filter(Boolean) as string[];

        if (context.warnings.length > 0) {
          lines.push("", "Warnings:", ...context.warnings.map((warning) => `- ${warning}`));
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Bootstrap error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
