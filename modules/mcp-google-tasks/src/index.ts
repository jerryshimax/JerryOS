#!/usr/bin/env node
/**
 * MCP Server for Google Tasks API.
 * Exposes task management tools via the Model Context Protocol.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createAuthClient,
  createTasksClient,
  listTaskLists,
  createTaskList,
  listTasks,
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  clearCompletedTasks,
  searchTasks,
} from "./google-tasks.js";

const server = new McpServer({
  name: "google-tasks",
  version: "1.0.0",
});

// Initialize Google Tasks client
const auth = createAuthClient();
const tasks = createTasksClient(auth);

// --- Helper ---

function formatTask(task: Record<string, unknown>): string {
  const t = task as {
    id?: string;
    title?: string;
    notes?: string;
    status?: string;
    due?: string;
    completed?: string;
    updated?: string;
    parent?: string;
    position?: string;
  };
  const lines: string[] = [];
  lines.push(`ID: ${t.id || "unknown"}`);
  lines.push(`Title: ${t.title || "(no title)"}`);
  if (t.notes) lines.push(`Notes: ${t.notes}`);
  lines.push(`Status: ${t.status || "unknown"}`);
  if (t.due) lines.push(`Due: ${t.due}`);
  if (t.completed) lines.push(`Completed: ${t.completed}`);
  if (t.updated) lines.push(`Updated: ${t.updated}`);
  if (t.parent) lines.push(`Parent: ${t.parent}`);
  return lines.join("\n");
}

function formatTaskList(tl: Record<string, unknown>): string {
  const t = tl as { id?: string; title?: string; updated?: string };
  return `ID: ${t.id || "unknown"}\nTitle: ${t.title || "(no title)"}\nUpdated: ${t.updated || "unknown"}`;
}

// --- Tools ---

server.tool(
  "list_tasklists",
  "List all Google Task lists",
  {},
  async () => {
    try {
      const lists = await listTaskLists(tasks);
      if (lists.length === 0) {
        return { content: [{ type: "text", text: "No task lists found." }] };
      }
      const text = lists
        .map((tl) => formatTaskList(tl as Record<string, unknown>))
        .join("\n---\n");
      return { content: [{ type: "text", text }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);

server.tool(
  "list_tasks",
  "List tasks in a task list. Use status filter: 'open' (default), 'completed', or 'all'",
  {
    task_list_id: z.string().describe("Task list ID (from list_tasklists)"),
    status_filter: z
      .enum(["open", "completed", "all"])
      .default("open")
      .describe("Filter by status: open, completed, or all"),
    due_min: z
      .string()
      .optional()
      .describe("Minimum due date (RFC 3339, e.g. 2026-03-22T00:00:00Z)"),
    due_max: z
      .string()
      .optional()
      .describe("Maximum due date (RFC 3339, e.g. 2026-04-01T00:00:00Z)"),
    max_results: z
      .number()
      .optional()
      .default(100)
      .describe("Max tasks to return (default 100)"),
  },
  async ({ task_list_id, status_filter, due_min, due_max, max_results }) => {
    try {
      const showCompleted = status_filter !== "open";
      let results = await listTasks(tasks, {
        taskListId: task_list_id,
        showCompleted,
        showHidden: status_filter === "all",
        dueMin: due_min,
        dueMax: due_max,
        maxResults: max_results,
      });

      // Apply status filter on the client side for "completed" only
      if (status_filter === "completed") {
        results = results.filter((t) => t.status === "completed");
      } else if (status_filter === "open") {
        results = results.filter((t) => t.status === "needsAction");
      }

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No ${status_filter} tasks found.` }],
        };
      }
      const text = results
        .map((t) => formatTask(t as unknown as Record<string, unknown>))
        .join("\n---\n");
      return { content: [{ type: "text", text: `${results.length} task(s):\n\n${text}` }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);

server.tool(
  "create_task",
  "Create a new task in a task list",
  {
    task_list_id: z.string().describe("Task list ID"),
    title: z.string().describe("Task title"),
    notes: z.string().optional().describe("Task notes/description"),
    due: z
      .string()
      .optional()
      .describe("Due date (RFC 3339, e.g. 2026-03-25T00:00:00Z, or just 2026-03-25)"),
    parent: z.string().optional().describe("Parent task ID to create a subtask"),
  },
  async ({ task_list_id, title, notes, due, parent }) => {
    try {
      // Normalize date: if just YYYY-MM-DD, append time
      let dueDate = due;
      if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) {
        dueDate = `${due}T00:00:00.000Z`;
      }

      const task = await createTask(tasks, {
        taskListId: task_list_id,
        title,
        notes,
        due: dueDate,
        parent,
      });
      return {
        content: [
          {
            type: "text",
            text: `Task created:\n${formatTask(task as unknown as Record<string, unknown>)}`,
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);

server.tool(
  "update_task",
  "Update an existing task (title, notes, due date, or status)",
  {
    task_list_id: z.string().describe("Task list ID"),
    task_id: z.string().describe("Task ID"),
    title: z.string().optional().describe("New title"),
    notes: z.string().optional().describe("New notes"),
    due: z
      .string()
      .optional()
      .describe("New due date (RFC 3339 or YYYY-MM-DD)"),
    status: z
      .enum(["needsAction", "completed"])
      .optional()
      .describe("New status"),
  },
  async ({ task_list_id, task_id, title, notes, due, status }) => {
    try {
      let dueDate = due;
      if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) {
        dueDate = `${due}T00:00:00.000Z`;
      }

      const task = await updateTask(tasks, {
        taskListId: task_list_id,
        taskId: task_id,
        title,
        notes,
        due: dueDate,
        status,
      });
      return {
        content: [
          {
            type: "text",
            text: `Task updated:\n${formatTask(task as unknown as Record<string, unknown>)}`,
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);

server.tool(
  "complete_task",
  "Mark a task as completed",
  {
    task_list_id: z.string().describe("Task list ID"),
    task_id: z.string().describe("Task ID"),
  },
  async ({ task_list_id, task_id }) => {
    try {
      const task = await completeTask(tasks, task_list_id, task_id);
      return {
        content: [
          {
            type: "text",
            text: `Task completed:\n${formatTask(task as unknown as Record<string, unknown>)}`,
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);

server.tool(
  "delete_task",
  "Delete a task",
  {
    task_list_id: z.string().describe("Task list ID"),
    task_id: z.string().describe("Task ID"),
  },
  async ({ task_list_id, task_id }) => {
    try {
      await deleteTask(tasks, task_list_id, task_id);
      return {
        content: [{ type: "text", text: "Task deleted successfully." }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);

server.tool(
  "create_tasklist",
  "Create a new task list",
  {
    title: z.string().describe("Name for the new task list"),
  },
  async ({ title }) => {
    try {
      const tl = await createTaskList(tasks, title);
      return {
        content: [
          {
            type: "text",
            text: `Task list created:\n${formatTaskList(tl as unknown as Record<string, unknown>)}`,
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);

server.tool(
  "search_tasks",
  "Search tasks by title or notes across all task lists (or a specific one)",
  {
    query: z.string().describe("Search text (case-insensitive, matches title and notes)"),
    task_list_id: z.string().optional().describe("Optional: limit search to a specific task list"),
  },
  async ({ query, task_list_id }) => {
    try {
      const results = await searchTasks(tasks, query, task_list_id);
      if (results.length === 0) {
        return { content: [{ type: "text", text: `No tasks matching "${query}".` }] };
      }
      const text = results
        .map(
          (r) =>
            `=== ${r.listTitle} ===\n${r.tasks
              .map((t) => formatTask(t as unknown as Record<string, unknown>))
              .join("\n---\n")}`
        )
        .join("\n\n");
      const total = results.reduce((n, r) => n + r.tasks.length, 0);
      return { content: [{ type: "text", text: `${total} result(s):\n\n${text}` }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);

server.tool(
  "clear_completed",
  "Remove all completed tasks from a task list",
  {
    task_list_id: z.string().describe("Task list ID"),
  },
  async ({ task_list_id }) => {
    try {
      await clearCompletedTasks(tasks, task_list_id);
      return { content: [{ type: "text", text: "Completed tasks cleared." }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Google Tasks MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
