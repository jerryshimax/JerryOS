import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  detectContactConflicts,
  findContact,
  scanContacts,
} from "./contact-store.js";

export function registerContactTools(server: McpServer): void {
  server.tool(
    "contact_lookup",
    "Look up normalized contacts across user_contacts.md and Brain [People] notes.",
    {
      query: z.string().describe("Name, alias, Telegram handle, org, or user id"),
      limit: z.number().optional().default(10),
    },
    async ({ query, limit }) => {
      try {
        const records = findContact(query).slice(0, limit);
        if (records.length === 0) {
          return {
            content: [{ type: "text", text: `No contacts found for "${query}".` }],
          };
        }

        const text = records
          .map((record, index) => {
            const handles =
              record.telegram_handles.length > 0
                ? ` | TG: ${record.telegram_handles.join(", ")}`
                : "";
            return `${index + 1}. ${record.canonical_name} [${record.source}]${handles}\n   ${record.relationship_summary.slice(0, 200)}`;
          })
          .join("\n\n");
        return { content: [{ type: "text", text }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Contact lookup error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "contact_conflicts",
    "Detect conflicts between normalized contacts and Brain [People] notes.",
    {},
    async () => {
      try {
        const conflicts = detectContactConflicts();
        if (conflicts.length === 0) {
          return {
            content: [{ type: "text", text: "No contact conflicts detected." }],
          };
        }

        const text = conflicts
          .map(
            (conflict, index) =>
              `${index + 1}. ${conflict.canonical_name}\n   ${conflict.reason}\n   Files: ${conflict.file_paths.join(", ")}`
          )
          .join("\n\n");
        return { content: [{ type: "text", text }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Contact conflict error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "contact_refresh",
    "Refresh and summarize the derived contact index.",
    {},
    async () => {
      try {
        const contacts = scanContacts();
        return {
          content: [
            {
              type: "text",
              text: `Scanned ${contacts.length} contact record(s).`,
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Contact refresh error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
