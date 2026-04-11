/**
 * Dispatch engine -- spawns claude -p subprocesses, tracks jobs, reaps completions.
 *
 * Key design:
 * - Job manifests persist to disk (survives bot crashes)
 * - Primary reply path: claude -p uses MCP send_message tool
 * - Backup: bot reads stdout JSON and sends via grammy
 * - Per-chat queuing: max 1 in-flight per chat, others queue
 * - Per-job try-catch: one bad subprocess never poisons others
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { spawn as nodeSpawn } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import type { Job, JobManifest, QueuedMessage } from './types'
import { buildPrompt, extractChatRules, type PromptParams } from './prompt'
import { logMessage } from './history'
import { sendToWarm, isWarmAlive } from './warm-session'
import { ALLOWED_TOOLS as SHARED_ALLOWED_TOOLS } from './tools'

const CLAUDE_BIN = join(homedir(), '.local', 'bin', 'claude')
const MCP_CONFIG = join(import.meta.dir, 'mcp-config.json')
const JOBS_DIR = join(import.meta.dir, 'jobs')
const FAILED_DIR = join(JOBS_DIR, 'failed')
const MANIFEST_FILE = join(import.meta.dir, '.jobs-manifest.json')

const DEFAULT_TIMEOUT_MS = 300_000 // 5 minutes
const MAX_CONCURRENT = 3
const MAX_QUEUE_PER_CHAT = 5
const REAPER_INTERVAL_MS = 3_000
const MAX_TURNS = 15

const ALLOWED_TOOLS = SHARED_ALLOWED_TOOLS

try { mkdirSync(JOBS_DIR, { recursive: true }) } catch {}
try { mkdirSync(FAILED_DIR, { recursive: true }) } catch {}

let manifest: JobManifest = {}
const chatQueues: Map<string, QueuedMessage[]> = new Map()
let onReply: ((chatId: string, text: string, replyTo?: number) => Promise<void>) | null = null

export function setReplyHandler(handler: (chatId: string, text: string, replyTo?: number) => Promise<void>) {
  onReply = handler
}

// -- Manifest persistence ----------------------------------------------------

function saveManifest(): void {
  try {
    writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2))
  } catch (e) {
    console.error(`[dispatch] Failed to save manifest: ${e}`)
  }
}

function loadManifest(): JobManifest {
  try {
    if (existsSync(MANIFEST_FILE)) {
      return JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'))
    }
  } catch {}
  return {}
}

// -- Job counting ------------------------------------------------------------

function runningJobCount(): number {
  return Object.values(manifest).filter(j => j.status === 'running').length
}

function chatHasRunningJob(chatId: string): boolean {
  return Object.values(manifest).some(j => j.chatId === chatId && j.status === 'running')
}

// -- Complexity detection ----------------------------------------------------

const HEAVY_PATTERNS = [
  /research|analyze|analysis|deep dive|investigate/i,
  /memo|evaluation/i,
  /compare|evaluate|assess|review.*contract/i,
  /model|financial|returns/i,
  /build|create.*app|create.*dashboard/i,
  /draft.*email|write.*letter|prepare.*deck/i,
]

function isHeavyRequest(text: string): boolean {
  if (text.length > 500) return true
  return HEAVY_PATTERNS.some(p => p.test(text))
}

// -- Dispatch ----------------------------------------------------------------

export async function dispatchMessage(msg: QueuedMessage & { isGroup: boolean; chatName?: string }): Promise<boolean> {
  const heavy = isHeavyRequest(msg.text)

  if (heavy && onReply) {
    console.log(`[dispatch] Heavy request detected -- sending ack`)
    await onReply(msg.chatId, 'On it -- this one will take a minute.', msg.messageId)
  }

  // Try warm session first (fast path)
  if (isWarmAlive()) {
    const chatRules = extractChatRules(msg.chatId)
    const startTime = Date.now()
    const result = await sendToWarm({
      chatId: msg.chatId,
      messageId: msg.messageId,
      userName: msg.userName,
      text: msg.text,
      chatRules,
      isGroup: msg.isGroup,
      chatName: msg.chatName,
      attachmentPath: msg.attachmentPath,
      replyContext: msg.replyContext,
    })

    if (result !== null) {
      const elapsed = Date.now() - startTime
      console.log(`[dispatch] Warm path completed in ${elapsed}ms for chat ${msg.chatId}`)

      if (!result.sentViaMcp && result.text && onReply) {
        await onReply(msg.chatId, result.text, msg.messageId)
      }
      logMessage(msg.chatId, { role: 'assistant', text: result.text })
      return true
    }
    console.log(`[dispatch] Warm session unavailable, falling back to cold path`)
  }

  // Cold fallback: spawn fresh claude -p per message
  if (chatHasRunningJob(msg.chatId)) {
    const queue = chatQueues.get(msg.chatId) ?? []
    if (queue.length >= MAX_QUEUE_PER_CHAT) {
      queue.shift()
    }
    queue.push(msg)
    chatQueues.set(msg.chatId, queue)
    console.log(`[dispatch] Queued message for chat ${msg.chatId} (queue size: ${queue.length})`)
    return true
  }

  if (runningJobCount() >= MAX_CONCURRENT) {
    const queue = chatQueues.get(msg.chatId) ?? []
    queue.push(msg)
    chatQueues.set(msg.chatId, queue)
    console.log(`[dispatch] At max concurrency (${MAX_CONCURRENT}), queued for chat ${msg.chatId}`)
    return true
  }

  return spawnJob(msg)
}

async function spawnJob(msg: QueuedMessage & { isGroup: boolean; chatName?: string }): Promise<boolean> {
  const jobId = `${msg.chatId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const logPath = join(JOBS_DIR, `${jobId}.log`)

  const prompt = buildPrompt({
    chatId: msg.chatId,
    userId: msg.userId,
    userName: msg.userName,
    text: msg.text,
    attachmentPath: msg.attachmentPath,
    isGroup: msg.isGroup,
    chatName: msg.chatName,
  })

  const { ANTHROPIC_API_KEY: _, ...cleanEnv } = process.env as Record<string, string>
  const env: Record<string, string> = {
    ...cleanEnv,
    HOME: homedir(),
    PATH: `${join(homedir(), '.local', 'bin')}:${join(homedir(), '.bun', 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
  }

  try {
    const { openSync, closeSync } = await import('fs')
    const outFd = openSync(logPath, 'w', 0o644)

    const proc = nodeSpawn(
      CLAUDE_BIN,
      [
        '-p', prompt,
        '--output-format', 'json',
        '--max-turns', String(MAX_TURNS),
        '--mcp-config', MCP_CONFIG,
        '--allowedTools', ALLOWED_TOOLS,
      ],
      {
        cwd: homedir(),
        env,
        stdio: ['ignore', outFd, outFd],
        detached: true,
      },
    )

    proc.unref()
    closeSync(outFd)

    if (!proc.pid) {
      console.error(`[dispatch] Spawn returned no PID for job ${jobId}`)
      return false
    }

    const job: Job = {
      id: jobId,
      pid: proc.pid,
      chatId: msg.chatId,
      messageId: msg.messageId,
      userName: msg.userName,
      startedAt: new Date().toISOString(),
      timeout: DEFAULT_TIMEOUT_MS,
      logPath,
      status: 'running',
      sentViaMcp: false,
    }

    manifest[jobId] = job
    saveManifest()

    console.log(`[dispatch] Spawned job ${jobId} (PID ${proc.pid}) for chat ${msg.chatId}`)
    return true
  } catch (e) {
    console.error(`[dispatch] Failed to spawn claude: ${e}`)
    return false
  }
}

// -- Reaper -- checks completed jobs every 3s --------------------------------

async function reapJobs(): Promise<void> {
  for (const [jobId, job] of Object.entries(manifest)) {
    if (job.status !== 'running') continue

    try {
      const alive = isProcessAlive(job.pid)
      const elapsed = Date.now() - new Date(job.startedAt).getTime()

      if (alive && elapsed > job.timeout) {
        console.log(`[dispatch] Job ${jobId} timed out after ${Math.round(elapsed / 1000)}s, killing PID ${job.pid}`)
        try { process.kill(job.pid, 'SIGTERM') } catch {}
        job.status = 'timeout'
        saveManifest()

        if (onReply) {
          await onReply(job.chatId, 'That took too long -- try a simpler request or I can retry.')
        }
        cleanupJob(jobId)
        drainQueue(job.chatId)
        continue
      }

      if (alive) continue

      job.status = 'completed'
      saveManifest()

      await handleJobOutput(jobId, job)
      cleanupJob(jobId)
      drainQueue(job.chatId)
    } catch (e) {
      console.error(`[dispatch] Reaper error for job ${jobId}: ${e}`)
      job.status = 'failed'
      saveManifest()

      if (onReply) {
        try {
          await onReply(job.chatId, 'Sorry, I hit an error processing that. Try again?')
        } catch {}
      }
      cleanupJob(jobId)
      drainQueue(job.chatId)
    }
  }
}

async function handleJobOutput(jobId: string, job: Job): Promise<void> {
  if (!onReply) return

  try {
    await Bun.sleep(200)

    if (!existsSync(job.logPath)) {
      console.log(`[dispatch] No log file for job ${jobId}`)
      return
    }

    const raw = readFileSync(job.logPath, 'utf8').trim()
    if (!raw) {
      console.log(`[dispatch] Empty log for job ${jobId}`)
      return
    }

    const data = JSON.parse(raw)
    const result = data.result || data.content || ''

    if (!result) {
      console.log(`[dispatch] No result in output for job ${jobId}`)
      return
    }

    const outputStr = typeof data === 'string' ? data : JSON.stringify(data)
    if (outputStr.includes('"send_message"') && outputStr.includes(job.chatId)) {
      console.log(`[dispatch] Job ${jobId} already sent reply via MCP, skipping grammy send`)
      job.sentViaMcp = true
      saveManifest()

      logMessage(job.chatId, { role: 'assistant', text: result })
      return
    }

    console.log(`[dispatch] Sending reply for job ${jobId} via grammy (${result.length} chars)`)
    await onReply(job.chatId, result, job.messageId)

    logMessage(job.chatId, { role: 'assistant', text: result })
  } catch (e) {
    console.error(`[dispatch] Failed to handle output for job ${jobId}: ${e}`)
    try {
      const failedPath = join(FAILED_DIR, `${jobId}.log`)
      if (existsSync(job.logPath)) {
        const content = readFileSync(job.logPath)
        writeFileSync(failedPath, content)
      }
    } catch {}

    await onReply(job.chatId, 'Sorry, I hit an error processing that. Try again?')
  }
}

function cleanupJob(jobId: string): void {
  const job = manifest[jobId]
  if (job) {
    try { if (existsSync(job.logPath)) unlinkSync(job.logPath) } catch {}
    delete manifest[jobId]
    saveManifest()
  }
}

async function drainQueue(chatId: string): Promise<void> {
  const queue = chatQueues.get(chatId)
  if (!queue || queue.length === 0) return

  if (queue.length === 1) {
    const msg = queue.shift()!
    chatQueues.set(chatId, queue)
    await spawnJob({ ...msg, isGroup: false })
    return
  }

  const combined = queue.map(m => `${m.userName}: ${m.text}`).join('\n')
  const first = queue[0]
  const last = queue[queue.length - 1]
  chatQueues.set(chatId, [])

  await spawnJob({
    chatId,
    messageId: last.messageId,
    userId: first.userId,
    userName: first.userName,
    text: combined,
    receivedAt: last.receivedAt,
    isGroup: false,
  })
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// -- Orphan recovery (on startup) --------------------------------------------

export function recoverOrphans(): void {
  manifest = loadManifest()
  let orphanCount = 0

  for (const [jobId, job] of Object.entries(manifest)) {
    if (job.status !== 'running') {
      delete manifest[jobId]
      continue
    }

    if (isProcessAlive(job.pid)) {
      console.log(`[dispatch] Orphan job ${jobId} (PID ${job.pid}) still running -- will reap when done`)
      orphanCount++
    } else {
      console.log(`[dispatch] Orphan job ${jobId} (PID ${job.pid}) already finished -- processing output`)
      job.status = 'completed'
      orphanCount++
    }
  }

  if (orphanCount > 0) {
    console.log(`[dispatch] Recovered ${orphanCount} orphan job(s)`)
    saveManifest()
  }
}

// -- Start reaper interval ---------------------------------------------------

let reaperHandle: ReturnType<typeof setInterval> | null = null

export function startReaper(): void {
  if (reaperHandle) return
  reaperHandle = setInterval(() => reapJobs().catch(e => console.error(`[dispatch] Reaper crash: ${e}`)), REAPER_INTERVAL_MS)
  console.log(`[dispatch] Reaper started (interval: ${REAPER_INTERVAL_MS}ms)`)
}

export function stopReaper(): void {
  if (reaperHandle) {
    clearInterval(reaperHandle)
    reaperHandle = null
  }
}
