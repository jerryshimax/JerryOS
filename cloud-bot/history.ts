/**
 * Chat history -- single-writer JSONL at ~/.claude/channels/telegram/history/
 * Only the bot process writes. Subprocesses never touch history directly.
 */

import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const HISTORY_DIR = join(homedir(), '.claude', 'channels', 'telegram', 'history')
const MAX_HISTORY_LINES = 500

try { mkdirSync(HISTORY_DIR, { recursive: true }) } catch {}

export interface HistoryEntry {
  role: 'user' | 'assistant'
  text: string
  user?: string
  user_id?: string
  message_id?: number
  [key: string]: unknown
}

export function logMessage(chatId: string, entry: HistoryEntry): void {
  try {
    const file = join(HISTORY_DIR, `${chatId}.jsonl`)
    const line = JSON.stringify({ ...entry, _ts: new Date().toISOString() }) + '\n'
    appendFileSync(file, line)

    try {
      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n').filter(l => l.trim())
      if (lines.length > MAX_HISTORY_LINES) {
        writeFileSync(file, lines.slice(-MAX_HISTORY_LINES).join('\n') + '\n')
      }
    } catch {}
  } catch (e) {
    console.error(`[history] logMessage failed for chat ${chatId}: ${e}`)
  }
}

export function getRecentHistory(chatId: string, count = 30): string {
  try {
    const file = join(HISTORY_DIR, `${chatId}.jsonl`)
    const content = readFileSync(file, 'utf8')
    const lines = content.split('\n').filter(l => l.trim())
    const recent = lines.slice(-count)
    return recent.map(line => {
      try {
        const e = JSON.parse(line)
        const ts = e._ts ? `[${e._ts}]` : ''
        if (e.role === 'user') return `${ts} ${e.user || 'User'}: ${e.text}`
        if (e.role === 'assistant') return `${ts} Assistant: ${e.text}`
        return `${ts} ${JSON.stringify(e)}`
      } catch { return line }
    }).join('\n')
  } catch { return '' }
}
