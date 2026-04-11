import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";

export type HandoffAgent = "claude" | "codex" | "system";
export type HandoffScope = "global" | "project";
export type HandoffStatus = "active" | "paused" | "blocked" | "completed";

export interface HandoffSnapshot {
  id: string;
  created_at: string;
  updated_at: string;
  source_agent: HandoffAgent;
  scope: HandoffScope;
  project_root: string | null;
  cwd: string | null;
  git: {
    branch: string | null;
    sha: string | null;
    dirty: boolean | null;
  };
  entity: "SYN" | "CE" | "UUL" | "FO" | null;
  status: HandoffStatus;
  title: string;
  summary: string;
  last_completed_step: string | null;
  next_step: string | null;
  blockers: string[];
  decisions: string[];
  touched_paths: string[];
  related_session_ids: string[];
  related_contacts: string[];
  tags: string[];
}

export interface HandoffSearchHit {
  snapshot: HandoffSnapshot;
  score: number;
  matched_fields: string[];
}

const HANDOFF_DIR = path.join(os.homedir(), "Ship", "logs", "handoffs");
const HANDOFF_HISTORY_PATH = path.join(HANDOFF_DIR, "handoff-history.jsonl");

export { HANDOFF_DIR, HANDOFF_HISTORY_PATH };

function isLowSignalSnapshot(snapshot: HandoffSnapshot): boolean {
  const text = [
    snapshot.title,
    snapshot.summary,
    snapshot.next_step || "",
    snapshot.last_completed_step || "",
  ]
    .join(" ")
    .toLowerCase();

  const markers = [
    "what were we just doing",
    "what were we doing",
    "context_bootstrap",
    "list the available tools",
    "use the memory mcp tool",
    "i don't have context from a previous conversation",
  ];

  return markers.some((marker) => text.includes(marker));
}

function ensureDir(): void {
  fs.mkdirSync(HANDOFF_DIR, { recursive: true });
}

function slugifyProjectRoot(projectRoot: string): string {
  return projectRoot
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function projectKey(projectRoot: string): string {
  const absPath = fs.existsSync(projectRoot)
    ? fs.realpathSync(projectRoot)
    : path.resolve(projectRoot);
  const baseName = path.basename(absPath).replace(/[^A-Za-z0-9._-]+/g, "-") || "root";
  const hash = createHash("sha1").update(absPath).digest("hex").slice(0, 12);
  return `${baseName.toLowerCase()}-${hash}`;
}

function uniqueTrimmed(values: string[] | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultSnapshot(snapshot: Partial<HandoffSnapshot>): HandoffSnapshot {
  const createdAt = snapshot.created_at || nowIso();
  const updatedAt = snapshot.updated_at || createdAt;
  const sourceAgent = snapshot.source_agent || "system";
  const legacyScope =
    typeof (snapshot as Record<string, unknown>).snapshot_scope === "string"
      ? String((snapshot as Record<string, unknown>).snapshot_scope)
      : null;
  const scope =
    snapshot.scope ||
    (legacyScope === "global" || legacyScope === "project"
      ? legacyScope
      : snapshot.project_root
        ? "project"
        : "global");
  const id =
    snapshot.id ||
    (Array.isArray((snapshot as Record<string, unknown>).related_sessions)
      ? `${String(((snapshot as Record<string, unknown>).related_sessions as unknown[])[0] || "snapshot")}-${scope}`
      : null) ||
    (typeof (snapshot as Record<string, unknown>).session_id === "string"
      ? `${String((snapshot as Record<string, unknown>).session_id)}-${scope}`
      : null) ||
    `${updatedAt.replace(/[:.]/g, "-")}-${sourceAgent}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  return {
    id,
    created_at: createdAt,
    updated_at: updatedAt,
    source_agent: sourceAgent,
    scope,
    project_root: snapshot.project_root || null,
    cwd: snapshot.cwd || null,
    git: {
      branch: snapshot.git?.branch || null,
      sha: snapshot.git?.sha || null,
      dirty: snapshot.git?.dirty ?? null,
    },
    entity: snapshot.entity || null,
    status: snapshot.status || "active",
    title: String(snapshot.title || "Untitled handoff").trim(),
    summary: String(snapshot.summary || "").trim(),
    last_completed_step: snapshot.last_completed_step || null,
    next_step: snapshot.next_step || null,
    blockers: uniqueTrimmed(snapshot.blockers),
    decisions: uniqueTrimmed(snapshot.decisions),
    touched_paths: uniqueTrimmed(snapshot.touched_paths),
    related_session_ids: uniqueTrimmed(
      snapshot.related_session_ids ||
        ((snapshot as Record<string, unknown>).related_sessions as string[] | undefined) ||
        (typeof (snapshot as Record<string, unknown>).session_id === "string"
          ? [String((snapshot as Record<string, unknown>).session_id)]
          : [])
    ),
    related_contacts: uniqueTrimmed(snapshot.related_contacts),
    tags: uniqueTrimmed(snapshot.tags),
  };
}

function listSnapshotFiles(): string[] {
  ensureDir();
  const results: string[] = [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      if (entry.name.startsWith("latest-") || entry.name === "latest.json") continue;
      results.push(fullPath);
    }
  }

  walk(HANDOFF_DIR);
  return results;
}

function readSnapshotFile(filePath: string): HandoffSnapshot | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return defaultSnapshot(JSON.parse(raw) as Partial<HandoffSnapshot>);
  } catch {
    return null;
  }
}

function writeLatestSnapshot(snapshot: HandoffSnapshot): void {
  ensureDir();
  const targets: string[] = [];

  if (snapshot.scope === "project" && snapshot.project_root) {
    const key = projectKey(snapshot.project_root);
    targets.push(
      path.join(HANDOFF_DIR, `latest-project-${slugifyProjectRoot(snapshot.project_root)}.json`),
      path.join(HANDOFF_DIR, "projects", key, "latest.json")
    );
  } else {
    targets.push(
      path.join(HANDOFF_DIR, "latest-global.json"),
      path.join(HANDOFF_DIR, "global", "latest.json")
    );
  }

  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
  }
}

function appendHistory(snapshot: HandoffSnapshot): void {
  ensureDir();
  fs.appendFileSync(HANDOFF_HISTORY_PATH, `${JSON.stringify(snapshot)}\n`, "utf-8");
}

export function upsertHandoff(snapshot: Partial<HandoffSnapshot>): HandoffSnapshot {
  ensureDir();
  const normalized = defaultSnapshot(snapshot);
  const snapshotPath = path.join(HANDOFF_DIR, `${normalized.id}.json`);

  fs.writeFileSync(snapshotPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  appendHistory(normalized);
  writeLatestSnapshot(normalized);

  return normalized;
}

export function listRecentHandoffs(
  limit: number = 10,
  projectRoot?: string
): HandoffSnapshot[] {
  const snapshots = listSnapshotFiles()
    .map((filePath) => readSnapshotFile(filePath))
    .filter((snapshot): snapshot is HandoffSnapshot => snapshot !== null)
    .filter((snapshot) =>
      projectRoot ? snapshot.project_root === projectRoot : true
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return snapshots.slice(0, limit);
}

export function getLatestHandoff(
  projectRoot?: string,
  scope?: HandoffScope
): HandoffSnapshot | null {
  ensureDir();

  function preferUseful(snapshot: HandoffSnapshot | null): HandoffSnapshot | null {
    if (!snapshot || !isLowSignalSnapshot(snapshot)) return snapshot;
    const recent = listRecentHandoffs(20, projectRoot).filter(
      (item) => !isLowSignalSnapshot(item)
    );
    return recent[0] || snapshot;
  }

  if (projectRoot && scope !== "global") {
    const key = projectKey(projectRoot);
    const legacyProjectPath = path.join(HANDOFF_DIR, "projects", key, "latest.json");
    if (fs.existsSync(legacyProjectPath)) {
      return preferUseful(readSnapshotFile(legacyProjectPath));
    }
    const projectPath = path.join(
      HANDOFF_DIR,
      `latest-project-${slugifyProjectRoot(projectRoot)}.json`
    );
    if (fs.existsSync(projectPath)) {
      return preferUseful(readSnapshotFile(projectPath));
    }
  }

  if (scope !== "project") {
    const legacyGlobalPath = path.join(HANDOFF_DIR, "global", "latest.json");
    if (fs.existsSync(legacyGlobalPath)) {
      return preferUseful(readSnapshotFile(legacyGlobalPath));
    }
    const globalPath = path.join(HANDOFF_DIR, "latest-global.json");
    if (fs.existsSync(globalPath)) {
      return preferUseful(readSnapshotFile(globalPath));
    }
  }

  const recent = listRecentHandoffs(1, projectRoot);
  return preferUseful(recent[0] || null);
}

function snapshotText(snapshot: HandoffSnapshot): string {
  return [
    snapshot.title,
    snapshot.summary,
    snapshot.last_completed_step || "",
    snapshot.next_step || "",
    snapshot.blockers.join(" "),
    snapshot.decisions.join(" "),
    snapshot.touched_paths.join(" "),
    snapshot.related_contacts.join(" "),
    snapshot.tags.join(" "),
    snapshot.entity || "",
    snapshot.project_root || "",
  ]
    .join("\n")
    .toLowerCase();
}

export function searchHandoffText(
  query: string,
  limit: number = 10
): HandoffSearchHit[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return [];

  const fields: Array<keyof HandoffSnapshot> = [
    "title",
    "summary",
    "last_completed_step",
    "next_step",
    "project_root",
    "entity",
  ];

  const hits = listRecentHandoffs(200)
    .map((snapshot) => {
      const haystack = snapshotText(snapshot);
      let score = 0;
      const matchedFields = new Set<string>();

      for (const token of tokens) {
        if (!haystack.includes(token)) continue;
        score += 1;
        for (const field of fields) {
          const value = snapshot[field];
          if (typeof value === "string" && value.toLowerCase().includes(token)) {
            matchedFields.add(String(field));
          }
        }
        if (snapshot.blockers.some((item) => item.toLowerCase().includes(token))) {
          matchedFields.add("blockers");
        }
        if (snapshot.decisions.some((item) => item.toLowerCase().includes(token))) {
          matchedFields.add("decisions");
        }
        if (
          snapshot.related_contacts.some((item) =>
            item.toLowerCase().includes(token)
          )
        ) {
          matchedFields.add("related_contacts");
        }
      }

      return {
        snapshot,
        score,
        matched_fields: Array.from(matchedFields),
      };
    })
    .filter((hit) => hit.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.snapshot.updated_at.localeCompare(a.snapshot.updated_at)
    );

  return hits.slice(0, limit);
}
