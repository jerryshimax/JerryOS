#!/usr/bin/env node
/**
 * CLI wrapper for session ingest — called by the session-export hook.
 *
 * Usage: node dist/ingest-cli.js <path-to-jsonl>
 */

import { ingestSessionFile } from "./session-db.js";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node ingest-cli.js <path-to-jsonl>");
  process.exit(1);
}

try {
  const result = ingestSessionFile(filePath);
  console.log(`Ingested ${result.sessions} session(s), ${result.messages} message(s) from ${filePath}`);
} catch (err) {
  console.error(`Ingest error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
