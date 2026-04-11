/**
 * Warm Session Manager -- uses session-id reuse for prompt cache hits.
 *
 * Architecture:
 * - Each message spawns a fresh `claude -p --session-id <fixed-uuid>`
 * - Anthropic's prompt cache kicks in on turn 2+ (90% cheaper, faster)
 * - Falls back gracefully if session breaks (caller uses cold path)
 * - Recycles session after 10K turns (effectively never -- keeps prompt cache warm)
 *
 * Speed: ~8-10s per message (7s subprocess startup + 1-2s API with cache)
 * vs 68s without session reuse (full context re-ingestion)
 */

import { spawn as nodeSpawn } from 'child_process'
import { readFileSync, writeFileSync, existsSync, openSync, closeSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import type { WarmRequest, WarmResult } from './types'
import { getRecentHistory } from './history'
import { logMessage } from './history'
import { loadBotContext } from './prompt'
import { ALLOWED_TOOLS as SHARED_ALLOWED_TOOLS } from './tools'

// -- Config ------------------------------------------------------------------

const CLAUDE_BIN = join(homedir(), '.local', 'bin', 'claude')
const MCP_CONFIG = join(import.meta.dir, 'mcp-config.json')
const SESSION_ID_FILE = join(import.meta.dir, '.warm-session-id')
const JOBS_DIR = join(import.meta.dir, 'jobs')

const BOT_NAME = process.env.BOT_NAME || 'Assistant'
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || ''

const MAX_TURNS = 10_000
const REQUEST_TIMEOUT_MS = 120_000
const MAX_TURNS_PER_CALL = 15

const ALLOWED_TOOLS = SHARED_ALLOWED_TOOLS

// Set to the model you want to use (e.g., 'claude-sonnet-4-20250514', 'claude-opus-4-6')
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'

// -- State -------------------------------------------------------------------

let sessionId: string = ''
let turnCount = 0
let busy = false

export let warmStats = {
  totalRequests: 0,
  totalMs: 0,
  lastRequests: [] as { chatId: string; ms: number; model: string; ts: string }[],
}

// -- Session ID persistence --------------------------------------------------

function loadSessionId(): string {
  try {
    if (existsSync(SESSION_ID_FILE)) {
      return readFileSync(SESSION_ID_FILE, 'utf8').trim()
    }
  } catch {}
  const id = randomUUID()
  writeFileSync(SESSION_ID_FILE, id)
  return id
}

function recycleSession(): void {
  sessionId = randomUUID()
  writeFileSync(SESSION_ID_FILE, sessionId)
  turnCount = 0
  console.log(`[warm] Recycled session -> ${sessionId.slice(0, 8)}...`)
}

// -- Lifecycle ---------------------------------------------------------------

export function startWarmSession(): void {
  sessionId = loadSessionId()
  turnCount = 0
  console.log(`[warm] Session ready (id: ${sessionId.slice(0, 8)}..., will use prompt cache on turn 2+)`)
}

export function stopWarmSession(): void {
  console.log('[warm] Session stopped')
}

export function isWarmAlive(): boolean {
  return !busy && sessionId !== ''
}

// -- Send message via warm session -------------------------------------------

export async function sendToWarm(req: WarmRequest): Promise<WarmResult | null> {
  if (busy) {
    console.log('[warm] Busy -- falling back to cold path')
    return null
  }

  busy = true
  const startTime = Date.now()

  try {
    const history = getRecentHistory(req.chatId, 100)
    const today = new Date().toISOString().split('T')[0]
    const botContext = loadBotContext()

    // Build prompt -- operating context first (cacheable prefix), then dynamic parts
    let prompt = ''
    if (botContext) {
      prompt += `<operating_context>\n${botContext}\n</operating_context>\n\n`
    }

    // TODO: Customize this system prompt for your bot's personality
    prompt += `You are ${BOT_NAME}, an AI assistant on Telegram.
Your response text will be sent directly to Telegram. Write naturally, no markdown (no ###, **). Be concise. Match the language of the conversation.

You have full tool access. When the user asks you to do something, DO it using your MCP tools -- don't just describe what you would do. Include a concise summary of what you did in your response.

[Chat: ${req.chatName || req.chatId} (${req.chatId}) | ${req.isGroup ? 'Group' : 'Private DM'} | Date: ${today}]`

    if (req.chatRules) {
      prompt += `\n\n<chat_rules>\n${req.chatRules}\n</chat_rules>`
    }

    if (history) {
      prompt += `\n\n<recent_history>\n${history}\n</recent_history>`
    }

    prompt += `\n\n${req.userName}: ${req.text}`

    if (req.attachmentPath) {
      const paths = req.attachmentPath.split(',')
      if (paths.length === 1) {
        prompt += `\n[Attachment: ${req.attachmentPath}]`
      } else {
        prompt += `\n[${paths.length} attachments:]`
        for (const p of paths) prompt += `\n[Attachment: ${p.trim()}]`
      }
    }

    if (req.replyContext) {
      prompt += `\n\n[User is replying to this message: "${req.replyContext}"]`
      prompt += `\nIMPORTANT: The user's message above is in the context of the quoted message. Act on that context.`
    }

    const modelArgs = ['--model', MODEL]

    const { ANTHROPIC_API_KEY: _, ...cleanEnv } = process.env as Record<string, string>
    const env: Record<string, string> = {
      ...cleanEnv,
      HOME: homedir(),
      PATH: `${join(homedir(), '.local', 'bin')}:${join(homedir(), '.bun', 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    }

    const logPath = join(JOBS_DIR, `warm_${Date.now()}.log`)
    const outFd = openSync(logPath, 'w', 0o644)

    const proc = nodeSpawn(
      CLAUDE_BIN,
      [
        '-p', prompt,
        '--output-format', 'json',
        '--max-turns', String(MAX_TURNS_PER_CALL),
        '--session-id', sessionId,
        '--no-session-persistence',
        '--mcp-config', MCP_CONFIG,
        '--allowedTools', ALLOWED_TOOLS,
        ...modelArgs,
      ],
      {
        cwd: homedir(),
        env,
        stdio: ['ignore', outFd, outFd],
      },
    )

    closeSync(outFd)

    if (!proc.pid) {
      console.error('[warm] Failed to spawn -- no PID')
      busy = false
      return null
    }

    const result = await new Promise<WarmResult | null>((resolve) => {
      const timer = setTimeout(() => {
        console.log(`[warm] Timed out after ${REQUEST_TIMEOUT_MS / 1000}s -- killing`)
        try { proc.kill('SIGTERM') } catch {}
        resolve(null)
      }, REQUEST_TIMEOUT_MS)

      proc.on('close', (code) => {
        clearTimeout(timer)
        try {
          const raw = readFileSync(logPath, 'utf8').trim()
          if (!raw) {
            console.log(`[warm] Empty output (exit code ${code})`)
            resolve(null)
            return
          }

          const data = JSON.parse(raw)
          const text = data.result || ''
          const sentViaMcp = raw.includes('send_message') && raw.includes(req.chatId)
          const cacheRead = data.usage?.cache_read_input_tokens || 0
          const cacheCreate = data.usage?.cache_creation_input_tokens || 0
          const duration = data.duration_ms || 0

          const totalMs = Date.now() - startTime
          const model = MODEL.split('-').slice(1, 2).join('')
          console.log(`[warm] Done in ${totalMs}ms (model: ${model}, API: ${duration}ms, cache read: ${cacheRead}, cache create: ${cacheCreate})`)

          warmStats.totalRequests++
          warmStats.totalMs += totalMs
          warmStats.lastRequests.push({ chatId: req.chatId, ms: totalMs, model, ts: new Date().toISOString() })
          if (warmStats.lastRequests.length > 10) warmStats.lastRequests.shift()

          resolve({ text, sentViaMcp })
        } catch (e) {
          console.error(`[warm] Failed to parse output: ${e}`)
          resolve(null)
        } finally {
          try { require('fs').unlinkSync(logPath) } catch {}
        }
      })
    })

    turnCount++
    if (turnCount >= MAX_TURNS) {
      recycleSession()
    }

    return result
  } catch (e) {
    console.error(`[warm] Error: ${e}`)
    return null
  } finally {
    busy = false
  }
}
