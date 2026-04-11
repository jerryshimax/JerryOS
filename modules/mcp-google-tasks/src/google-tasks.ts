/**
 * Google Tasks API client wrapper.
 * Handles OAuth2 token management and all Tasks API operations.
 */

import { google, tasks_v1 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import fs from "node:fs";
import path from "node:path";

const TOKEN_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || ".",
  ".config",
  "mcp-google-tasks"
);
const TOKEN_PATH = path.join(TOKEN_DIR, "tokens.json");

export function createAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required"
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "http://localhost:9876/oauth2callback"
  );

  // Load saved tokens
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      `No tokens found at ${TOKEN_PATH}. Run 'npm run auth' first to authenticate.`
    );
  }

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  oauth2Client.setCredentials(tokens);

  // Auto-save refreshed tokens
  oauth2Client.on("tokens", (newTokens) => {
    const existing = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    const merged = { ...existing, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2), {
      mode: 0o600,
    });
  });

  return oauth2Client;
}

export function createTasksClient(auth: OAuth2Client): tasks_v1.Tasks {
  return google.tasks({ version: "v1", auth });
}

// --- Task List Operations ---

export async function listTaskLists(
  client: tasks_v1.Tasks
): Promise<tasks_v1.Schema$TaskList[]> {
  const res = await client.tasklists.list({ maxResults: 100 });
  return res.data.items || [];
}

export async function createTaskList(
  client: tasks_v1.Tasks,
  title: string
): Promise<tasks_v1.Schema$TaskList> {
  const res = await client.tasklists.insert({
    requestBody: { title },
  });
  return res.data;
}

// --- Task Operations ---

export interface ListTasksOptions {
  taskListId: string;
  showCompleted?: boolean;
  showHidden?: boolean;
  dueMin?: string;
  dueMax?: string;
  maxResults?: number;
}

export async function listTasks(
  client: tasks_v1.Tasks,
  opts: ListTasksOptions
): Promise<tasks_v1.Schema$Task[]> {
  const res = await client.tasks.list({
    tasklist: opts.taskListId,
    showCompleted: opts.showCompleted ?? true,
    showHidden: opts.showHidden ?? false,
    dueMin: opts.dueMin,
    dueMax: opts.dueMax,
    maxResults: opts.maxResults ?? 100,
  });
  return res.data.items || [];
}

export interface CreateTaskOptions {
  taskListId: string;
  title: string;
  notes?: string;
  due?: string; // RFC 3339 date string
  parent?: string; // Parent task ID for subtasks
}

export async function createTask(
  client: tasks_v1.Tasks,
  opts: CreateTaskOptions
): Promise<tasks_v1.Schema$Task> {
  const res = await client.tasks.insert({
    tasklist: opts.taskListId,
    requestBody: {
      title: opts.title,
      notes: opts.notes,
      due: opts.due,
    },
    parent: opts.parent,
  });
  return res.data;
}

export interface UpdateTaskOptions {
  taskListId: string;
  taskId: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: "needsAction" | "completed";
}

export async function updateTask(
  client: tasks_v1.Tasks,
  opts: UpdateTaskOptions
): Promise<tasks_v1.Schema$Task> {
  // First get the current task to preserve fields
  const current = await client.tasks.get({
    tasklist: opts.taskListId,
    task: opts.taskId,
  });

  const body: tasks_v1.Schema$Task = {
    ...current.data,
    ...(opts.title !== undefined && { title: opts.title }),
    ...(opts.notes !== undefined && { notes: opts.notes }),
    ...(opts.due !== undefined && { due: opts.due }),
    ...(opts.status !== undefined && { status: opts.status }),
  };

  // If completing, set completed timestamp; if reopening, clear it
  if (opts.status === "completed") {
    body.completed = new Date().toISOString();
  } else if (opts.status === "needsAction") {
    body.completed = undefined;
  }

  const res = await client.tasks.update({
    tasklist: opts.taskListId,
    task: opts.taskId,
    requestBody: body,
  });
  return res.data;
}

export async function completeTask(
  client: tasks_v1.Tasks,
  taskListId: string,
  taskId: string
): Promise<tasks_v1.Schema$Task> {
  return updateTask(client, {
    taskListId,
    taskId,
    status: "completed",
  });
}

export async function deleteTask(
  client: tasks_v1.Tasks,
  taskListId: string,
  taskId: string
): Promise<void> {
  await client.tasks.delete({
    tasklist: taskListId,
    task: taskId,
  });
}

export async function clearCompletedTasks(
  client: tasks_v1.Tasks,
  taskListId: string
): Promise<void> {
  await client.tasks.clear({
    tasklist: taskListId,
  });
}

export async function searchTasks(
  client: tasks_v1.Tasks,
  query: string,
  taskListId?: string
): Promise<{ listTitle: string; tasks: tasks_v1.Schema$Task[] }[]> {
  const q = query.toLowerCase();
  const lists = taskListId
    ? [{ id: taskListId, title: taskListId }]
    : await listTaskLists(client);

  const results: { listTitle: string; tasks: tasks_v1.Schema$Task[] }[] = [];

  for (const list of lists) {
    if (!list.id) continue;
    const tasks = await listTasks(client, {
      taskListId: list.id,
      showCompleted: true,
      showHidden: true,
      maxResults: 100,
    });
    const matched = tasks.filter(
      (t) =>
        t.title?.toLowerCase().includes(q) ||
        t.notes?.toLowerCase().includes(q)
    );
    if (matched.length > 0) {
      results.push({ listTitle: list.title || list.id, tasks: matched });
    }
  }

  return results;
}
