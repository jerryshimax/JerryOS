#!/usr/bin/env node
/**
 * Memory MCP Server — gives Claude search + recall over all memory and Brain files.
 *
 * Tools:
 * - memory_search: Full-text ranked search across memory + Brain vault
 * - memory_read: Read a specific memory or Brain file
 * - memory_list: List memories by source/type
 * - memory_stats: Index statistics and health
 * - memory_health: Liveness check — watcher status, last event, index age
 * - memory_stale: Find stale memories that need review
 * - memory_log: Write/append to today's daily session log
 * - memory_reindex: Force a full reindex
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { watch } from "chokidar";
import {
  reindex,
  indexFile,
  removeFile,
  search,
  getStats,
  findStaleMemories,
  cleanupExpiredMemories,
  getAllDocuments,
  getHealthStatus,
  setWatcherActive,
  recordWatcherEvent,
  recordWatcherError,
  incrementWatcherRestarts,
  MEMORY_DIR,
  BRAIN_DIR,
  DAILY_DIR,
} from "./indexer.js";
import { registerSessionTools } from "./session-tools.js";
import { registerHandoffTools } from "./handoff-tools.js";
import { registerContactTools } from "./contact-tools.js";
import { registerBootstrapTools } from "./bootstrap-tools.js";
import {
  initEmbeddings,
  embedDocument,
  removeEmbedding,
  persistEmbeddings,
  getEmbeddingStats,
} from "./embeddings.js";

const server = new McpServer({
  name: "memory",
  version: "1.0.0",
});

// Register session tools (FTS5-backed session search/recall/summary/ingest/stats)
registerSessionTools(server);
registerHandoffTools(server);
registerContactTools(server);
registerBootstrapTools(server);

// Init: full index on startup
const initialStats = reindex();
console.error(
  `Memory MCP: indexed ${initialStats.indexed} files, removed ${initialStats.removed}`
);

// Init embeddings (loads cache, starts model download in background)
initEmbeddings().catch((err) =>
  console.error(`Memory MCP: embeddings init error: ${err}`)
);

// Persist embeddings every 5 minutes
setInterval(() => {
  persistEmbeddings().catch((err) =>
    console.error(`Memory MCP: persist error: ${err}`)
  );
}, 5 * 60 * 1000);

// Watch for file changes — incremental reindex with health tracking and crash recovery
const WATCH_PATHS = [
  path.join(MEMORY_DIR, "*.md"),
  path.join(MEMORY_DIR, "daily", "*.md"),
  path.join(BRAIN_DIR, "*.md"),
];

let activeWatcher: ReturnType<typeof watch> | null = null;

function setupWatcher(): void {
  try {
    activeWatcher = watch(WATCH_PATHS, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500 },
    });

    activeWatcher.on("ready", () => {
      console.error("Memory MCP: file watcher ready");
      setWatcherActive(true);
    });

    activeWatcher.on("add", (fp) => {
      console.error(`Memory MCP: new file ${path.basename(fp)}`);
      recordWatcherEvent();
      indexFile(fp);
      // Embed in background
      const content = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "";
      if (content) {
        const stat = fs.statSync(fp);
        embedDocument(fp, content, stat.mtimeMs).catch(() => {});
      }
    });

    activeWatcher.on("change", (fp) => {
      console.error(`Memory MCP: updated ${path.basename(fp)}`);
      recordWatcherEvent();
      indexFile(fp);
      // Re-embed in background
      const content = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "";
      if (content) {
        const stat = fs.statSync(fp);
        embedDocument(fp, content, stat.mtimeMs).catch(() => {});
      }
    });

    activeWatcher.on("unlink", (fp) => {
      console.error(`Memory MCP: removed ${path.basename(fp)}`);
      recordWatcherEvent();
      removeFile(fp);
      removeEmbedding(fp);
    });

    activeWatcher.on("error", (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Memory MCP: watcher error — ${msg}`);
      recordWatcherError(msg);

      // Attempt one restart
      const health = getHealthStatus();
      if (health.watcherRestartCount < 1) {
        console.error("Memory MCP: attempting watcher restart...");
        incrementWatcherRestarts();
        try {
          activeWatcher?.close();
        } catch { /* ignore close errors */ }
        setTimeout(() => setupWatcher(), 2000);
      } else {
        console.error("Memory MCP: watcher already restarted once — not retrying. Use memory_reindex to manually refresh.");
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Memory MCP: failed to set up watcher — ${msg}`);
    recordWatcherError(msg);
  }
}

setupWatcher();

// --- Tools ---

server.tool(
  "memory_search",
  "Search across all memory files and Brain vault notes. Hybrid mode (default) combines BM25 keyword search with semantic vector search for best recall. Returns ranked results with snippets.",
  {
    query: z.string().describe("Search query — natural language or keywords"),
    source: z
      .enum(["memory", "brain", "daily"])
      .optional()
      .describe(
        "Filter by source: memory (Claude memory files), brain (Obsidian vault), daily (session logs)"
      ),
    type: z
      .string()
      .optional()
      .describe(
        "Filter by type: user, feedback, project, reference (memory) or Research, Memos, Meetings, People, etc. (Brain)"
      ),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Max results (default 10)"),
    mode: z
      .enum(["hybrid", "bm25", "vector"])
      .optional()
      .default("hybrid")
      .describe("Search mode: hybrid (BM25+vector, default), bm25 (keyword only), vector (semantic only)"),
  },
  async ({ query, source, type, limit, mode }) => {
    try {
      const results = await search(query, { source, type, limit, mode });
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No results for "${query}". Try broader terms or different filters.`,
            },
          ],
        };
      }

      const formatted = results
        .map((r, i) => {
          const lines = [
            `${i + 1}. **${r.name}** [${r.source}/${r.type}]`,
            `   File: ${r.fileName}`,
          ];
          if (r.description) lines.push(`   Desc: ${r.description}`);
          lines.push(
            `   Score: ${r.score.toFixed(2)}`
          );
          lines.push(`   ${r.snippet.replace(/\n/g, " ").trim()}`);
          if (r.overlaps && r.overlaps.length > 0) {
            lines.push(`   ⚠ Overlaps: ${r.overlaps.join(", ")}`);
          }
          return lines.join("\n");
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `${results.length} result(s) for "${query}":\n\n${formatted}`,
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Search error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "memory_read",
  "Read the full contents of a specific memory or Brain file by filename",
  {
    file_name: z
      .string()
      .describe(
        "Filename to read (e.g., 'user_jerry_profile.md' or '[People] John Smith.md')"
      ),
  },
  async ({ file_name }) => {
    try {
      // Search across all known directories
      const candidates = [
        path.join(MEMORY_DIR, file_name),
        path.join(BRAIN_DIR, file_name),
        path.join(DAILY_DIR, file_name),
      ];

      for (const fp of candidates) {
        if (fs.existsSync(fp)) {
          const content = fs.readFileSync(fp, "utf-8");
          return {
            content: [
              {
                type: "text",
                text: `--- ${file_name} (${fp}) ---\n\n${content}`,
              },
            ],
          };
        }
      }

      // Try partial match via indexed docs
      const allDocs = getAllDocuments();
      const match = allDocs.find(
        (d) =>
          d.fileName.toLowerCase().includes(file_name.toLowerCase()) ||
          d.name.toLowerCase().includes(file_name.toLowerCase())
      );

      if (match && fs.existsSync(match.filePath)) {
        const content = fs.readFileSync(match.filePath, "utf-8");
        return {
          content: [
            {
              type: "text",
              text: `--- ${match.fileName} (${match.filePath}) ---\n\n${content}`,
            },
          ],
        };
      }

      return {
        content: [{ type: "text", text: `File not found: ${file_name}` }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Read error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "memory_list",
  "List all indexed memories, optionally filtered by source or type",
  {
    source: z
      .enum(["memory", "brain", "daily"])
      .optional()
      .describe("Filter by source"),
    type: z.string().optional().describe("Filter by type"),
    sort_by: z
      .enum(["name", "modified", "type"])
      .optional()
      .default("modified")
      .describe("Sort order (default: most recently modified first)"),
  },
  async ({ source, type, sort_by }) => {
    try {
      let docs = getAllDocuments();

      if (source) docs = docs.filter((d) => d.source === source);
      if (type) docs = docs.filter((d) => d.type === type);

      // Sort
      if (sort_by === "name") {
        docs.sort((a, b) => a.name.localeCompare(b.name));
      } else if (sort_by === "type") {
        docs.sort(
          (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
        );
      } else {
        docs.sort((a, b) => b.modifiedAt - a.modifiedAt);
      }

      if (docs.length === 0) {
        return {
          content: [{ type: "text", text: "No files match the filters." }],
        };
      }

      const formatted = docs
        .map((r) => {
          const ago = Math.floor(
            (Date.now() - r.modifiedAt) / (1000 * 60 * 60 * 24)
          );
          const desc = r.description ? ` — ${r.description}` : "";
          return `- [${r.source}/${r.type}] **${r.name}**${desc} (${ago}d ago)`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `${docs.length} file(s):\n\n${formatted}`,
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `List error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "memory_stats",
  "Show index statistics: total files, breakdown by source and type",
  {},
  async () => {
    try {
      const stats = getStats();
      const lines = [
        `**Memory Index Stats**`,
        `Total indexed: ${stats.totalFiles} files`,
        ``,
        `By source:`,
        ...Object.entries(stats.bySource).map(([k, v]) => `  ${k}: ${v}`),
        ``,
        `By type:`,
        ...Object.entries(stats.byType).map(([k, v]) => `  ${k}: ${v}`),
      ];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Stats error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "memory_health",
  "Liveness check for the memory MCP server. Reports watcher status, last event time, index age, and any errors. Use this to verify the file watcher hasn't crashed.",
  {},
  async () => {
    try {
      const health = getHealthStatus();
      const lines = [
        `**Memory MCP Health**`,
        ``,
        `Watcher active: ${health.watcherActive ? "YES" : "NO"}`,
      ];

      if (health.watcherError) {
        lines.push(`Watcher error: ${health.watcherError}`);
      }
      if (health.watcherRestartCount > 0) {
        lines.push(`Watcher restarts: ${health.watcherRestartCount}`);
      }

      lines.push(`Last watcher event: ${health.lastWatcherEventAgo}`);
      lines.push(`Last full reindex: ${health.lastReindexAgo}`);
      lines.push(`Total indexed files: ${health.totalIndexedFiles}`);

      // Embedding stats
      const embStats = getEmbeddingStats();
      lines.push(``);
      lines.push(`**Embeddings**`);
      lines.push(`Model loaded: ${embStats.modelLoaded ? "YES" : "NO (loading...)"}`);
      lines.push(`Vectors cached: ${embStats.totalEmbedded}`);
      lines.push(`Cache on disk: ${embStats.cacheExists ? "YES" : "NO"}`);

      if (health.watcherStale) {
        lines.push(``);
        lines.push(`WARNING: ${health.watcherStaleReason}`);
        lines.push(`Recommendation: run memory_reindex to refresh, or restart the MCP server.`);
      } else if (health.watcherActive) {
        lines.push(``);
        lines.push(`Status: healthy`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Health check error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "memory_stale",
  "Find stale memories that may need updating or removal. Projects stale after 14d, feedback after 30d, user/reference after 60d.",
  {},
  async () => {
    try {
      const stale = findStaleMemories();
      if (stale.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No stale memories found — all up to date.",
            },
          ],
        };
      }

      const formatted = stale
        .map((s) => {
          const lines = [
            `- **${s.name}** [${s.type}] ${s.status === "expired" ? "EXPIRED" : ""} — ${s.daysSinceModified}d since update`,
            `  ${s.reason}`,
            `  File: ${s.fileName}`,
          ];
          if (s.overlaps && s.overlaps.length > 0) {
            lines.push(`  ⚠ Overlaps >70% with: ${s.overlaps.join(", ")}`);
          }
          return lines.join("\n");
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `${stale.length} stale memory file(s):\n\n${formatted}`,
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Stale check error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "memory_cleanup",
  "Archive expired memories (past TTL date) and daily logs older than 90 days. Files are moved to archive/ subdirectories, not deleted. Default is dry run — shows what would be archived without making changes.",
  {
    dry_run: z
      .boolean()
      .optional()
      .default(true)
      .describe("If true (default), only report what would be cleaned up"),
  },
  async ({ dry_run }) => {
    try {
      const result = cleanupExpiredMemories(dry_run);
      const total = result.archived.length + result.dailyArchived.length;

      if (total === 0) {
        return {
          content: [
            { type: "text", text: "Nothing to clean up — no expired memories or old daily logs." },
          ],
        };
      }

      const lines = [
        dry_run ? "**Dry run** — no changes made:" : "**Cleanup complete:**",
        "",
      ];

      if (result.archived.length > 0) {
        lines.push(`Expired memories (${result.archived.length}):`);
        for (const f of result.archived) lines.push(`  - ${f}`);
      }
      if (result.dailyArchived.length > 0) {
        lines.push(`Old daily logs >90d (${result.dailyArchived.length}):`);
        for (const f of result.dailyArchived) lines.push(`  - ${f}`);
      }

      if (dry_run) {
        lines.push("");
        lines.push("Run with dry_run=false to execute.");
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Cleanup error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "memory_log",
  "Write or append to today's daily session log. Persists key decisions, topics, and context from the current session so future sessions can recall what happened today.",
  {
    entry: z
      .string()
      .describe(
        "Log entry — key decisions, topics discussed, state changes, context to carry forward"
      ),
    tags: z
      .array(z.string())
      .optional()
      .describe("Optional tags (e.g., ['CE', 'fundraising', 'deal'])"),
  },
  async ({ entry, tags }) => {
    try {
      // Ensure daily directory exists
      if (!fs.existsSync(DAILY_DIR)) {
        fs.mkdirSync(DAILY_DIR, { recursive: true });
      }

      const today = new Date().toISOString().split("T")[0];
      const dailyPath = path.join(DAILY_DIR, `${today}.md`);
      const timestamp = new Date().toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      });
      const tagStr =
        tags && tags.length > 0 ? ` [${tags.join(", ")}]` : "";

      if (!fs.existsSync(dailyPath)) {
        const content = `---
name: Daily Log ${today}
description: Session log for ${today} — key decisions, topics, and context
type: daily
---

# Daily Log — ${today}

## ${timestamp}${tagStr}
${entry}
`;
        fs.writeFileSync(dailyPath, content, "utf-8");
      } else {
        const appendContent = `\n## ${timestamp}${tagStr}\n${entry}\n`;
        fs.appendFileSync(dailyPath, appendContent, "utf-8");
      }

      // Reindex the file
      indexFile(dailyPath);

      return {
        content: [
          {
            type: "text",
            text: `Logged to ${today}.md at ${timestamp}`,
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Log error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "memory_reindex",
  "Force a full reindex of all memory and Brain files. Use after bulk changes or if search seems stale.",
  {},
  async () => {
    try {
      const stats = reindex();
      const indexStats = getStats();
      return {
        content: [
          {
            type: "text",
            text: `Reindex complete: ${stats.indexed} updated, ${stats.removed} removed. Total: ${indexStats.totalFiles} files indexed.`,
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Reindex error: ${message}` }],
        isError: true,
      };
    }
  }
);

// --- Start ---

async function main() {
  // Handle --reindex flag for CLI usage
  if (process.argv.includes("--reindex")) {
    const stats = reindex();
    const indexStats = getStats();
    console.log(
      `Reindex complete: ${stats.indexed} updated, ${stats.removed} removed.`
    );
    console.log(`Total: ${indexStats.totalFiles} files indexed.`);
    console.log(`By source:`, indexStats.bySource);
    console.log(`By type:`, indexStats.byType);
    process.exit(0);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Memory MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
