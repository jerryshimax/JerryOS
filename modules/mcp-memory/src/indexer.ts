/**
 * Memory Indexer — Pure JS full-text search engine.
 *
 * Indexes:
 * 1. Claude memory files (~/.claude/projects/[project]/memory/)
 * 2. Brain vault files (configured via BRAIN_DIR)
 * 3. Daily session logs (~/.claude/projects/[project]/memory/daily/)
 *
 * Uses TF-IDF scoring with Porter stemming for ranked search.
 * Zero native dependencies — runs anywhere Node runs.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// --- Paths ---

const HOME = os.homedir();
// Auto-detect the Claude project memory directory
function findMemoryDir(): string {
  const projectsDir = path.join(HOME, ".claude", "projects");
  if (fs.existsSync(projectsDir)) {
    const dirs = fs.readdirSync(projectsDir).filter(d =>
      fs.existsSync(path.join(projectsDir, d, "memory"))
    );
    if (dirs.length > 0) {
      return path.join(projectsDir, dirs[0], "memory");
    }
  }
  return path.join(projectsDir, "default", "memory");
}

const MEMORY_DIR = process.env.MEMORY_DIR || findMemoryDir();
const BRAIN_DIR = process.env.BRAIN_DIR || path.join(HOME, "Brain");
const DAILY_DIR = path.join(MEMORY_DIR, "daily");

export { MEMORY_DIR, BRAIN_DIR, DAILY_DIR };

// --- Watcher Health Tracking ---

let lastWatcherEventAt: number = 0;
let lastReindexAt: number = 0;
let watcherActive: boolean = false;
let watcherRestartCount: number = 0;
let watcherError: string | null = null;

export function setWatcherActive(active: boolean): void {
  watcherActive = active;
  if (active) watcherError = null;
}

export function recordWatcherEvent(): void {
  lastWatcherEventAt = Date.now();
}

export function recordWatcherError(err: string): void {
  watcherError = err;
  watcherActive = false;
}

export function incrementWatcherRestarts(): void {
  watcherRestartCount++;
}

export interface HealthStatus {
  watcherActive: boolean;
  watcherError: string | null;
  watcherRestartCount: number;
  lastWatcherEventAt: number | null;
  lastWatcherEventAgo: string;
  lastReindexAt: number | null;
  lastReindexAgo: string;
  totalIndexedFiles: number;
  watcherStale: boolean;
  watcherStaleReason: string | null;
}

function formatAgo(ts: number): string {
  if (ts === 0) return "never";
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function getHealthStatus(): HealthStatus {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  // Check if watcher is stale: no events in >1 hour and files have been modified
  let watcherStale = false;
  let watcherStaleReason: string | null = null;

  if (watcherActive && lastWatcherEventAt > 0 && (now - lastWatcherEventAt) > ONE_HOUR) {
    // Check if any watched files were modified more recently than last event
    const dirs = [MEMORY_DIR, BRAIN_DIR, DAILY_DIR];
    let newestFileMtime = 0;
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          if (!entry.endsWith(".md")) continue;
          try {
            const stat = fs.statSync(path.join(dir, entry));
            if (stat.mtimeMs > newestFileMtime) newestFileMtime = stat.mtimeMs;
          } catch { /* skip unreadable files */ }
        }
      } catch { /* skip unreadable dirs */ }
    }

    if (newestFileMtime > lastWatcherEventAt) {
      watcherStale = true;
      watcherStaleReason = `Watcher silent for ${formatAgo(lastWatcherEventAt)} but files modified ${formatAgo(newestFileMtime)} — watcher may have crashed`;
      console.error(`WARNING: ${watcherStaleReason}`);
    }
  }

  return {
    watcherActive,
    watcherError,
    watcherRestartCount,
    lastWatcherEventAt: lastWatcherEventAt || null,
    lastWatcherEventAgo: formatAgo(lastWatcherEventAt),
    lastReindexAt: lastReindexAt || null,
    lastReindexAgo: formatAgo(lastReindexAt),
    totalIndexedFiles: docStore.size,
    watcherStale,
    watcherStaleReason,
  };
}

// --- Porter Stemmer (minimal) ---

function stem(word: string): string {
  // Simple suffix stripping — covers 80% of cases
  let w = word.toLowerCase();
  if (w.length < 4) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("tion")) return w.slice(0, -4);
  if (w.endsWith("ment") && w.length > 6) return w.slice(0, -4);
  if (w.endsWith("ness") && w.length > 5) return w.slice(0, -4);
  if (w.endsWith("able") && w.length > 6) return w.slice(0, -4);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("ly") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("es") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, " ") // keep Chinese chars
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .map(stem);
}

// --- Data Types ---

export interface ParsedFile {
  filePath: string;
  fileName: string;
  source: "memory" | "brain" | "daily";
  name: string;
  description: string;
  type: string;
  content: string;
  modifiedAt: number;
  expires?: string; // ISO date string from frontmatter "expires:" field
}

export interface SearchResult {
  filePath: string;
  fileName: string;
  source: string;
  name: string;
  description: string;
  type: string;
  snippet: string;
  score: number;
  overlaps?: string[];
}

export interface IndexStats {
  totalFiles: number;
  bySource: Record<string, number>;
  byType: Record<string, number>;
  lastIndexed: string;
}

export interface StaleMemory {
  filePath: string;
  fileName: string;
  type: string;
  name: string;
  daysSinceModified: number;
  reason: string;
  status: "stale" | "expired";
  overlaps?: string[];
}

// --- Frontmatter Parser ---

function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { meta, body: match[2] };
}

function extractBrainType(fileName: string): string {
  const m = fileName.match(/^\[([^\]]+)\]/);
  return m ? m[1] : "other";
}

function parseFile(
  filePath: string,
  source: "memory" | "brain" | "daily"
): ParsedFile | null {
  try {
    const stat = fs.statSync(filePath);
    const raw = fs.readFileSync(filePath, "utf-8");
    const fileName = path.basename(filePath);
    const { meta, body } = parseFrontmatter(raw);

    return {
      filePath,
      fileName,
      source,
      name: meta.name || fileName.replace(/\.md$/, ""),
      description: meta.description || "",
      type:
        source === "brain"
          ? extractBrainType(fileName)
          : meta.type || source,
      content: body.trim(),
      modifiedAt: stat.mtimeMs,
      expires: meta.expires || undefined,
    };
  } catch (err) {
    console.error(`Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// --- In-Memory Index ---

// Inverted index: stemmed term -> Set of file paths
const invertedIndex = new Map<string, Set<string>>();
// Document store: filePath -> ParsedFile
const docStore = new Map<string, ParsedFile>();
// Document term frequencies: filePath -> Map<term, count>
const docTermFreqs = new Map<string, Map<string, number>>();
// Document lengths (total tokens)
const docLengths = new Map<string, number>();
// Supersession map: filePath -> list of files it overlaps with (>70% Jaccard)
const supersessionMap = new Map<string, string[]>();
// Raw token sets for Jaccard computation (memory source only)
const docTokenSets = new Map<string, Set<string>>();

function indexDocument(doc: ParsedFile): void {
  // Remove old entry first
  removeDocument(doc.filePath);

  docStore.set(doc.filePath, doc);

  // Combine all searchable text with field weights
  // Name and description get 3x weight by repeating
  const searchText = [
    doc.name, doc.name, doc.name,
    doc.description, doc.description, doc.description,
    doc.fileName, doc.fileName,
    doc.type,
    doc.content,
  ].join(" ");

  const tokens = tokenize(searchText);
  const termFreq = new Map<string, number>();

  for (const token of tokens) {
    termFreq.set(token, (termFreq.get(token) || 0) + 1);
    if (!invertedIndex.has(token)) {
      invertedIndex.set(token, new Set());
    }
    invertedIndex.get(token)!.add(doc.filePath);
  }

  docTermFreqs.set(doc.filePath, termFreq);
  docLengths.set(doc.filePath, tokens.length);

  // Overlap detection for memory files
  if (doc.source === "memory") {
    const contentTokens = new Set(tokenize(doc.content));
    docTokenSets.set(doc.filePath, contentTokens);
    checkSupersession(doc.filePath, contentTokens);
  }
}

function removeDocument(filePath: string): void {
  const termFreq = docTermFreqs.get(filePath);
  if (termFreq) {
    for (const term of termFreq.keys()) {
      const docs = invertedIndex.get(term);
      if (docs) {
        docs.delete(filePath);
        if (docs.size === 0) invertedIndex.delete(term);
      }
    }
  }
  docStore.delete(filePath);
  docTermFreqs.delete(filePath);
  docLengths.delete(filePath);
  docTokenSets.delete(filePath);
  supersessionMap.delete(filePath);
}

// --- Overlap Detection (Jaccard Similarity) ---

function checkSupersession(filePath: string, tokens: Set<string>): void {
  if (tokens.size < 5) return; // skip tiny files

  const overlaps: string[] = [];
  for (const [otherPath, otherTokens] of docTokenSets) {
    if (otherPath === filePath) continue;

    let intersectionSize = 0;
    for (const t of tokens) {
      if (otherTokens.has(t)) intersectionSize++;
    }
    const unionSize = tokens.size + otherTokens.size - intersectionSize;
    const jaccard = unionSize > 0 ? intersectionSize / unionSize : 0;

    if (jaccard > 0.7) {
      const otherDoc = docStore.get(otherPath);
      overlaps.push(otherDoc?.fileName || path.basename(otherPath));
    }
  }

  if (overlaps.length > 0) {
    supersessionMap.set(filePath, overlaps);
  }
}

// --- File Collection ---

function collectFiles(
  dir: string,
  source: "memory" | "brain" | "daily"
): ParsedFile[] {
  const files: ParsedFile[] = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    if (entry === "MEMORY.md") continue;
    if (entry.startsWith(".")) continue;
    // Skip subdirectories for memory (daily has its own collection)
    const fullPath = path.join(dir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
    } catch (err) {
      console.error(`Failed to stat ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const parsed = parseFile(fullPath, source);
    if (parsed) files.push(parsed);
  }
  return files;
}

// --- Public API ---

export function reindex(): { indexed: number; removed: number } {
  const allFiles: ParsedFile[] = [
    ...collectFiles(MEMORY_DIR, "memory"),
    ...collectFiles(BRAIN_DIR, "brain"),
    ...collectFiles(DAILY_DIR, "daily"),
  ];

  const newPaths = new Set(allFiles.map((f) => f.filePath));
  const oldPaths = new Set(docStore.keys());

  let indexed = 0;
  let removed = 0;

  // Index new and updated files
  for (const file of allFiles) {
    const existing = docStore.get(file.filePath);
    if (!existing || existing.modifiedAt < file.modifiedAt) {
      indexDocument(file);
      indexed++;
    }
  }

  // Remove deleted files
  for (const oldPath of oldPaths) {
    if (!newPaths.has(oldPath)) {
      removeDocument(oldPath);
      removed++;
    }
  }

  lastReindexAt = Date.now();
  return { indexed, removed };
}

export function indexFile(filePath: string): void {
  let source: "memory" | "brain" | "daily";
  if (filePath.startsWith(DAILY_DIR)) {
    source = "daily";
  } else if (filePath.startsWith(MEMORY_DIR)) {
    source = "memory";
  } else if (filePath.startsWith(BRAIN_DIR)) {
    source = "brain";
  } else {
    return;
  }

  const parsed = parseFile(filePath, source);
  if (parsed) indexDocument(parsed);
}

export function removeFile(filePath: string): void {
  removeDocument(filePath);
}

// --- Search (BM25 + optional vector hybrid) ---

import {
  embedText,
  vectorSearch as vecSearch,
  isModelReady,
} from "./embeddings.js";

function bm25Search(
  query: string,
  options: { source?: string; type?: string; limit?: number }
): Array<{ filePath: string; score: number }> {
  const { source, type, limit = 40 } = options;
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const N = docStore.size;
  if (N === 0) return [];

  let totalLen = 0;
  for (const len of docLengths.values()) totalLen += len;
  const avgDl = totalLen / N;

  const k1 = 1.2;
  const b = 0.75;
  const scores = new Map<string, number>();

  for (const term of queryTerms) {
    const matchingDocs = invertedIndex.get(term);
    if (!matchingDocs) continue;

    const df = matchingDocs.size;
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

    for (const docPath of matchingDocs) {
      const doc = docStore.get(docPath);
      if (!doc) continue;
      if (source && doc.source !== source) continue;
      if (type && doc.type !== type) continue;

      const tf = docTermFreqs.get(docPath)?.get(term) || 0;
      const dl = docLengths.get(docPath) || 1;
      const score = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl))));
      scores.set(docPath, (scores.get(docPath) || 0) + score);
    }
  }

  const now = Date.now();
  for (const [docPath, score] of scores) {
    const doc = docStore.get(docPath)!;
    const daysOld = (now - doc.modifiedAt) / (1000 * 60 * 60 * 24);
    const recencyBoost = 1 + Math.max(0, 0.1 * (1 - daysOld / 30));
    scores.set(docPath, score * recencyBoost);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([filePath, score]) => ({ filePath, score }));
}

function rrfMerge(
  bm25Results: Array<{ filePath: string; score: number }>,
  vectorResults: Array<{ filePath: string; score: number }>,
  limit: number,
  k: number = 60
): string[] {
  const scores = new Map<string, number>();
  bm25Results.forEach((r, i) => {
    scores.set(r.filePath, (scores.get(r.filePath) || 0) + 1 / (k + i + 1));
  });
  vectorResults.forEach((r, i) => {
    scores.set(r.filePath, (scores.get(r.filePath) || 0) + 1 / (k + i + 1));
  });
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([fp]) => fp);
}

export async function search(
  query: string,
  options: {
    source?: string;
    type?: string;
    limit?: number;
    mode?: "hybrid" | "bm25" | "vector";
  } = {}
): Promise<SearchResult[]> {
  const { source, type, limit = 20, mode = "hybrid" } = options;
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const N = docStore.size;
  if (N === 0) return [];

  // BM25 results
  const bm25Results = bm25Search(query, { source, type, limit: limit * 2 });

  // Decide if we can run vector search
  const useVector = mode !== "bm25" && isModelReady();

  let rankedPaths: string[];

  if (useVector) {
    try {
      const queryVec = await embedText(query);
      const vecResults = vecSearch(queryVec, limit * 2);
      // Filter by source/type
      const filtered = vecResults.filter((r) => {
        const doc = docStore.get(r.filePath);
        if (!doc) return false;
        if (source && doc.source !== source) return false;
        if (type && doc.type !== type) return false;
        return true;
      });

      if (mode === "vector") {
        rankedPaths = filtered.slice(0, limit).map((r) => r.filePath);
      } else {
        // Hybrid: RRF merge
        rankedPaths = rrfMerge(bm25Results, filtered, limit);
      }
    } catch {
      // Fallback to BM25
      rankedPaths = bm25Results.slice(0, limit).map((r) => r.filePath);
    }
  } else {
    rankedPaths = bm25Results.slice(0, limit).map((r) => r.filePath);
  }

  // Build score map for display (use BM25 scores as primary display score)
  const bm25ScoreMap = new Map(bm25Results.map((r) => [r.filePath, r.score]));

  const sorted = rankedPaths.slice(0, limit);

  const results: SearchResult[] = [];
  for (const docPath of sorted) {
    const doc = docStore.get(docPath);
    if (!doc) continue;
    const overlaps = supersessionMap.get(docPath);
    results.push({
      filePath: doc.filePath,
      fileName: doc.fileName,
      source: doc.source,
      name: doc.name,
      description: doc.description,
      type: doc.type,
      snippet: extractSnippet(doc.content, queryTerms),
      score: bm25ScoreMap.get(docPath) || 0,
      overlaps,
    });
  }
  return results;
}

function extractSnippet(content: string, queryTerms: string[]): string {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return "";

  // Find the line with the most query term matches
  let bestLine = 0;
  let bestCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    let count = 0;
    for (const term of queryTerms) {
      // Check both stemmed and original presence
      if (lower.includes(term)) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestLine = i;
    }
  }

  // Take up to 3 lines starting from best match
  const start = Math.max(0, bestLine);
  const end = Math.min(lines.length, start + 3);
  const snippet = lines.slice(start, end).join(" ").trim();

  return snippet.length > 300 ? snippet.slice(0, 297) + "..." : snippet;
}

// --- Stats ---

export function getStats(): IndexStats {
  const bySource: Record<string, number> = {};
  const byType: Record<string, number> = {};

  for (const doc of docStore.values()) {
    bySource[doc.source] = (bySource[doc.source] || 0) + 1;
    byType[doc.type] = (byType[doc.type] || 0) + 1;
  }

  return {
    totalFiles: docStore.size,
    bySource,
    byType,
    lastIndexed: lastReindexAt ? new Date(lastReindexAt).toISOString() : "never",
  };
}

// --- Stale Memory Detection ---

export function findStaleMemories(): StaleMemory[] {
  const now = Date.now();
  const today = new Date().toISOString().split("T")[0];
  const stale: StaleMemory[] = [];

  for (const doc of docStore.values()) {
    if (doc.source !== "memory") continue;

    const daysSince = Math.floor(
      (now - doc.modifiedAt) / (1000 * 60 * 60 * 24)
    );

    // Check TTL expiry first
    if (doc.expires && doc.expires <= today) {
      const overlaps = supersessionMap.get(doc.filePath);
      stale.push({
        filePath: doc.filePath,
        fileName: doc.fileName,
        type: doc.type,
        name: doc.name,
        daysSinceModified: daysSince,
        reason: `Memory expired (TTL: ${doc.expires})`,
        status: "expired",
        overlaps,
      });
      continue;
    }

    const threshold =
      doc.type === "project"
        ? 14
        : doc.type === "feedback"
        ? 30
        : 60;

    if (daysSince > threshold) {
      const overlaps = supersessionMap.get(doc.filePath);
      stale.push({
        filePath: doc.filePath,
        fileName: doc.fileName,
        type: doc.type,
        name: doc.name,
        daysSinceModified: daysSince,
        reason:
          doc.type === "project"
            ? `Project memory not updated in ${daysSince} days — may be completed or stale`
            : `${doc.type} memory not updated in ${daysSince} days — verify still accurate`,
        status: "stale",
        overlaps,
      });
    }
  }

  return stale.sort((a, b) => b.daysSinceModified - a.daysSinceModified);
}

// --- Memory Cleanup ---

export function cleanupExpiredMemories(dryRun: boolean = true): {
  archived: string[];
  dailyArchived: string[];
} {
  const today = new Date().toISOString().split("T")[0];
  const now = Date.now();
  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
  const archived: string[] = [];
  const dailyArchived: string[] = [];

  // 1. Archive expired memory files
  const memoryArchive = path.join(MEMORY_DIR, "archive");
  for (const doc of docStore.values()) {
    if (doc.source !== "memory") continue;
    if (!doc.expires || doc.expires > today) continue;

    if (!dryRun) {
      fs.mkdirSync(memoryArchive, { recursive: true });
      const dest = path.join(memoryArchive, doc.fileName);
      fs.renameSync(doc.filePath, dest);
      removeDocument(doc.filePath);
    }
    archived.push(doc.fileName);
  }

  // 2. Archive daily logs > 90 days old
  const dailyArchiveDir = path.join(DAILY_DIR, "archive");
  if (fs.existsSync(DAILY_DIR)) {
    for (const entry of fs.readdirSync(DAILY_DIR)) {
      if (!entry.endsWith(".md")) continue;
      const fp = path.join(DAILY_DIR, entry);
      try {
        const stat = fs.statSync(fp);
        if (!stat.isFile()) continue;
        if (now - stat.mtimeMs > NINETY_DAYS) {
          if (!dryRun) {
            fs.mkdirSync(dailyArchiveDir, { recursive: true });
            fs.renameSync(fp, path.join(dailyArchiveDir, entry));
            removeDocument(fp);
          }
          dailyArchived.push(entry);
        }
      } catch { /* skip */ }
    }
  }

  return { archived, dailyArchived };
}

// --- Get a specific document ---

export function getDocument(filePath: string): ParsedFile | undefined {
  return docStore.get(filePath);
}

export function getAllDocuments(): ParsedFile[] {
  return [...docStore.values()];
}
