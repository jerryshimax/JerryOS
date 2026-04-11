/**
 * Vector Embeddings — local semantic search using all-MiniLM-L6-v2.
 *
 * Provides 384-dim embeddings via @huggingface/transformers (ONNX, runs locally).
 * Persists to ~/.cache/mcp-memory/ as binary + JSON manifest.
 * ~200 files × 384 dims × 4 bytes = ~300KB on disk.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CACHE_DIR = path.join(os.homedir(), ".cache", "mcp-memory");
const EMBEDDINGS_BIN = path.join(CACHE_DIR, "embeddings.bin");
const EMBEDDINGS_META = path.join(CACHE_DIR, "embeddings.meta.json");
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const DIM = 384;

// In-memory vector store
const embeddings = new Map<string, Float32Array>();
const metaStore = new Map<string, { mtimeMs: number }>();
let dirty = false;

// Lazy-loaded pipeline
let pipelineInstance: any = null;
let pipelineLoading: Promise<any> | null = null;
let modelReady = false;

async function getPipeline(): Promise<any> {
  if (pipelineInstance) return pipelineInstance;
  if (pipelineLoading) return pipelineLoading;

  pipelineLoading = (async () => {
    console.error("Memory MCP: loading embedding model (one-time, ~30MB)...");
    const { pipeline, env } = await import("@huggingface/transformers");
    // Cache models locally
    env.cacheDir = path.join(CACHE_DIR, "models");
    pipelineInstance = await pipeline("feature-extraction", MODEL_NAME, {
      dtype: "fp32",
    });
    modelReady = true;
    console.error("Memory MCP: embedding model ready");
    return pipelineInstance;
  })();

  return pipelineLoading;
}

// --- Public API ---

export async function initEmbeddings(): Promise<void> {
  // Load persisted embeddings from disk
  if (fs.existsSync(EMBEDDINGS_META) && fs.existsSync(EMBEDDINGS_BIN)) {
    try {
      const meta = JSON.parse(fs.readFileSync(EMBEDDINGS_META, "utf-8"));
      const buffer = fs.readFileSync(EMBEDDINGS_BIN);
      const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);

      for (const [filePath, info] of Object.entries(meta.entries as Record<string, { offset: number; mtimeMs: number }>)) {
        const start = info.offset;
        const vec = floats.slice(start, start + DIM);
        embeddings.set(filePath, vec);
        metaStore.set(filePath, { mtimeMs: info.mtimeMs });
      }
      console.error(`Memory MCP: loaded ${embeddings.size} cached embeddings`);
    } catch (err) {
      console.error(`Memory MCP: failed to load cached embeddings: ${err}`);
    }
  }

  // Start loading model in background (don't block)
  getPipeline().catch((err) => {
    console.error(`Memory MCP: embedding model failed to load: ${err}`);
  });
}

export async function embedText(text: string): Promise<Float32Array> {
  const pipe = await getPipeline();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return new Float32Array(output.data);
}

export async function embedDocument(
  filePath: string,
  text: string,
  mtimeMs: number
): Promise<void> {
  // Skip if already embedded with same mtime
  const existing = metaStore.get(filePath);
  if (existing && existing.mtimeMs >= mtimeMs) return;

  try {
    const vec = await embedText(text);
    embeddings.set(filePath, vec);
    metaStore.set(filePath, { mtimeMs });
    dirty = true;
  } catch (err) {
    // Non-fatal — search falls back to BM25
    console.error(`Memory MCP: embed failed for ${path.basename(filePath)}: ${err}`);
  }
}

export function removeEmbedding(filePath: string): void {
  if (embeddings.has(filePath)) {
    embeddings.delete(filePath);
    metaStore.delete(filePath);
    dirty = true;
  }
}

export function vectorSearch(
  queryEmbedding: Float32Array,
  limit: number = 20
): Array<{ filePath: string; score: number }> {
  const results: Array<{ filePath: string; score: number }> = [];

  for (const [filePath, vec] of embeddings) {
    // Cosine similarity (vectors are normalized, so dot product = cosine)
    let dot = 0;
    for (let i = 0; i < DIM; i++) {
      dot += queryEmbedding[i] * vec[i];
    }
    if (dot > 0.1) {
      results.push({ filePath, score: dot });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export async function persistEmbeddings(): Promise<void> {
  if (!dirty || embeddings.size === 0) return;

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const entries: Record<string, { offset: number; mtimeMs: number }> = {};
  const buffer = new Float32Array(embeddings.size * DIM);
  let offset = 0;

  for (const [filePath, vec] of embeddings) {
    buffer.set(vec, offset);
    const meta = metaStore.get(filePath);
    entries[filePath] = { offset, mtimeMs: meta?.mtimeMs || 0 };
    offset += DIM;
  }

  fs.writeFileSync(EMBEDDINGS_BIN, Buffer.from(buffer.buffer));
  fs.writeFileSync(
    EMBEDDINGS_META,
    JSON.stringify({ version: 1, dim: DIM, entries }, null, 2)
  );

  dirty = false;
  console.error(`Memory MCP: persisted ${embeddings.size} embeddings`);
}

export function isModelReady(): boolean {
  return modelReady;
}

export function getEmbeddingStats(): {
  totalEmbedded: number;
  modelLoaded: boolean;
  cacheExists: boolean;
} {
  return {
    totalEmbedded: embeddings.size,
    modelLoaded: modelReady,
    cacheExists: fs.existsSync(EMBEDDINGS_BIN),
  };
}
