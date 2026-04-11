#!/usr/bin/env bun
/**
 * Standalone Telegram Bot
 *
 * Decoupled from Claude Code -- runs as its own LaunchAgent.
 * Polls Telegram via grammy, dispatches claude -p for AI reasoning.
 */

import { Bot } from 'grammy'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { gate, getResponseMode, isMentioned } from './access'
import { logMessage } from './history'
import { dispatchMessage, setReplyHandler, startReaper, stopReaper, recoverOrphans } from './dispatch'
import { startWarmSession, stopWarmSession, isWarmAlive, warmStats } from './warm-session'
import { discoverFallbackIps, installFallbackTransport } from './fallback-transport'

// -- Config ------------------------------------------------------------------

const STATE_DIR = join(homedir(), '.claude', 'channels', 'telegram')
const ENV_FILE = join(STATE_DIR, '.env')
const LOCK_FILE = join(STATE_DIR, 'bot-polling.lock')
const LOG_FILE = join(homedir(), 'logs', 'tg-bot.log')
const CRASH_LOG = join(import.meta.dir, '.crash-log')

// TODO: Set your admin chat ID here (used for crash alerts)
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || ''
const BOT_NAME = process.env.BOT_NAME || 'Assistant'

const TYPING_INTERVAL_MS = 4_000
const WATCHDOG_INTERVAL_MS = 3_600_000

// -- Load .env ---------------------------------------------------------------

try {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
if (!TOKEN) {
  console.error(`[bot] TELEGRAM_BOT_TOKEN not set. Expected in ${ENV_FILE}`)
  process.exit(1)
}

// -- Logging -----------------------------------------------------------------

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stdout.write(line)
}

// -- Crash loop protection ---------------------------------------------------

function checkCrashLoop(): void {
  const now = Date.now()
  let crashes: number[] = []
  try {
    if (existsSync(CRASH_LOG)) {
      crashes = JSON.parse(readFileSync(CRASH_LOG, 'utf8'))
    }
  } catch {}

  crashes.push(now)
  crashes = crashes.filter(t => now - t < 300_000)
  writeFileSync(CRASH_LOG, JSON.stringify(crashes))

  if (crashes.length >= 4) {
    log(`[bot] CRASH LOOP DETECTED (${crashes.length} crashes in 5 min) -- alerting admin and exiting clean`)
    if (ADMIN_CHAT_ID && TOKEN) {
      try {
        const msg = encodeURIComponent(`${BOT_NAME} bot is crash-looping. Check logs.`)
        Bun.spawnSync({
          cmd: ['curl', '-s', '-X', 'POST',
            `https://api.telegram.org/bot${TOKEN}/sendMessage?chat_id=${ADMIN_CHAT_ID}&text=${msg}`],
          stdout: 'ignore', stderr: 'ignore',
        })
      } catch {}
    }
    process.exit(0)
  }
}

checkCrashLoop()

// -- PID Lock ----------------------------------------------------------------

function acquireLock(): boolean {
  if (existsSync(LOCK_FILE)) {
    const lockData = readFileSync(LOCK_FILE, 'utf8').trim()
    const lines = lockData.split('\n')
    const lockPid = parseInt(lines[0], 10)
    const lockTime = lines[1] ? new Date(lines[1]).getTime() : 0

    if (!isNaN(lockPid) && lockPid !== process.pid) {
      try {
        process.kill(lockPid, 0)
        const age = Date.now() - lockTime
        if (age < 10_000) {
          log(`[bot] Lock held by PID ${lockPid} (${Math.round(age / 1000)}s old), waiting 5s...`)
          Bun.sleepSync(5_000)
          try {
            process.kill(lockPid, 0)
            log(`[bot] Lock still held by PID ${lockPid} -- exiting`)
            return false
          } catch {
            log(`[bot] PID ${lockPid} died during wait -- taking over`)
          }
        } else {
          log(`[bot] Lock held by PID ${lockPid} (${Math.round(age / 1000)}s old) -- killing stale holder`)
          try { process.kill(lockPid, 'SIGTERM') } catch {}
          Bun.sleepSync(2_000)
        }
      } catch {
        log(`[bot] Stale lock from dead PID ${lockPid} -- taking over`)
      }
    }
  }

  writeFileSync(LOCK_FILE, `${process.pid}\n${new Date().toISOString()}\n`, { mode: 0o600 })
  log(`[bot] Lock acquired (PID ${process.pid})`)
  return true
}

function releaseLock(): void {
  try {
    if (existsSync(LOCK_FILE)) {
      const lockPid = parseInt(readFileSync(LOCK_FILE, 'utf8').split('\n')[0], 10)
      if (lockPid === process.pid) unlinkSync(LOCK_FILE)
    }
  } catch {}
}

if (!acquireLock()) {
  process.exit(1)
}

// -- Bot init ----------------------------------------------------------------

const bot = new Bot(TOKEN)
let botUsername = ''
let lastPollSuccess = Date.now()
const botStartTime = Date.now()

const typingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map()

function startTyping(chatId: string): void {
  bot.api.sendChatAction(chatId, 'typing').catch(() => {})
  const handle = setInterval(() => {
    bot.api.sendChatAction(chatId, 'typing').catch(() => {})
  }, TYPING_INTERVAL_MS)
  typingIntervals.set(chatId, handle)
}

function stopTyping(chatId: string): void {
  const handle = typingIntervals.get(chatId)
  if (handle) {
    clearInterval(handle)
    typingIntervals.delete(chatId)
  }
}

// -- Reply handler (called by dispatch reaper) -------------------------------

const MAX_CHUNK = 4096

/** Resilient send: 3-attempt retry with backoff, markdown fallback on parse errors */
async function safeSend(chatId: string, text: string, opts?: any): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await bot.api.sendMessage(chatId, text, opts)
      return
    } catch (e: any) {
      const msg = String(e?.message || e || '').toLowerCase()

      if (msg.includes('parse') || msg.includes("can't parse")) {
        log(`[send] Parse error, retrying plain text: ${e?.message}`)
        const plain = text.replace(/[*_`~\[\]()>#+=|{}.!\\-]/g, '')
        try {
          await bot.api.sendMessage(chatId, plain, opts)
        } catch (e2: any) {
          log(`[send] Plain text retry also failed: ${e2?.message}`)
        }
        return
      }

      if (e?.error_code === 429) {
        const wait = e?.parameters?.retry_after || 2 ** attempt
        log(`[send] Rate limited, waiting ${wait}s (attempt ${attempt + 1}/3)`)
        await Bun.sleep(wait * 1000)
        continue
      }

      if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('network') || msg.includes('econnrefused') || (e?.error_code && e.error_code >= 500)) {
        if (attempt < 2) {
          const wait = 2 ** attempt
          log(`[send] Transient error, retrying in ${wait}s (attempt ${attempt + 1}/3): ${e?.message}`)
          await Bun.sleep(wait * 1000)
          continue
        }
      }

      log(`[send] Failed to send to ${chatId} (attempt ${attempt + 1}/3): ${e?.message || e}`)
      return
    }
  }
}

async function sendReply(chatId: string, text: string, replyTo?: number): Promise<void> {
  stopTyping(chatId)

  if (!text || !text.trim()) return

  if (text.length <= MAX_CHUNK) {
    await safeSend(chatId, text, replyTo ? { reply_parameters: { message_id: replyTo } } : undefined)
    return
  }

  const chunks: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > MAX_CHUNK) {
      if (current) chunks.push(current)
      current = line
    } else {
      current += (current ? '\n' : '') + line
    }
  }
  if (current) chunks.push(current)

  for (let i = 0; i < chunks.length; i++) {
    const opts = i === 0 && replyTo ? { reply_parameters: { message_id: replyTo } } : undefined
    await safeSend(chatId, chunks[i], opts)
  }
}

setReplyHandler(sendReply)

// -- Message handlers --------------------------------------------------------

function getChatName(chatId: string): string | undefined {
  try {
    const access = JSON.parse(readFileSync(join(STATE_DIR, 'access.json'), 'utf8')
    )
    return access.groups?.[chatId]?.name
  } catch { return undefined }
}

function getReplyContext(ctx: any): string | undefined {
  const reply = ctx.message?.reply_to_message
  if (!reply) return undefined

  const parts: string[] = []
  const replyUser = reply.from?.first_name || reply.from?.username || 'Unknown'
  if (reply.text) {
    parts.push(`${replyUser}: ${reply.text}`)
  } else if (reply.caption) {
    parts.push(`${replyUser}: ${reply.caption}`)
  } else if (reply.photo) {
    parts.push(`${replyUser}: [Photo]`)
  } else if (reply.document) {
    parts.push(`${replyUser}: [Document: ${reply.document.file_name || 'file'}]`)
  } else {
    parts.push(`${replyUser}: [message]`)
  }
  return parts.join('\n')
}

bot.on('message:text', async (ctx) => {
  const chatId = String(ctx.chat.id)
  const userId = String(ctx.from.id)
  const userName = ctx.from.first_name || ctx.from.username || 'Unknown'
  const text = ctx.message.text
  const replyContext = getReplyContext(ctx)

  if (gate(ctx, botUsername) === 'drop') return

  lastPollSuccess = Date.now()
  log(`[msg] ${chatId} ${userName}: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}${replyContext ? ' [reply]' : ''}`)

  // /status command -- instant, no Claude spawn
  if (text.trim().toLowerCase() === '/status') {
    const uptime = Math.round((Date.now() - botStartTime) / 1000)
    const uptimeStr = uptime > 3600 ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m` : `${Math.floor(uptime / 60)}m ${uptime % 60}s`
    const warmAlive = isWarmAlive()
    const avgMs = warmStats.totalRequests > 0 ? Math.round(warmStats.totalMs / warmStats.totalRequests) : 0

    let status = `${BOT_NAME} Bot Status\n\n`
    status += `Uptime: ${uptimeStr}\n`
    status += `Warm session: ${warmAlive ? 'alive' : 'dead'}\n`
    status += `Total requests: ${warmStats.totalRequests}\n`
    status += `Avg response: ${avgMs}ms\n`

    if (warmStats.lastRequests.length > 0) {
      status += `\nRecent:\n`
      for (const r of warmStats.lastRequests.slice(-5)) {
        status += `  ${r.model} ${r.ms}ms (${r.ts.split('T')[1]?.slice(0, 5)})\n`
      }
    }

    await ctx.reply(status)
    return
  }

  // Log inbound to history
  logMessage(chatId, {
    role: 'user',
    text,
    user: userName,
    user_id: userId,
    message_id: ctx.message.message_id,
  })

  // Selective response filter for groups
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'
  if (isGroup) {
    const mode = getResponseMode(chatId)
    if (mode === 'selective' || mode === 'mention-only') {
      const mentioned = isMentioned(ctx, botUsername)
      const botNameLower = BOT_NAME.toLowerCase()
      const nameCalled = mode === 'selective' && new RegExp(`\\b${botNameLower}\\b`, 'i').test(text)
      if (!mentioned && !nameCalled) {
        log(`[filter] Skipping ${chatId} -- responseMode=${mode}, not addressed`)
        return
      }
    }
  }

  startTyping(chatId)

  const dispatched = await dispatchMessage({
    chatId,
    messageId: ctx.message.message_id,
    userId,
    userName,
    text,
    replyContext,
    receivedAt: new Date().toISOString(),
    isGroup,
    chatName: getChatName(chatId),
  })

  if (!dispatched) {
    stopTyping(chatId)
    log(`[msg] Failed to dispatch for chat ${chatId}`)
  }
})

// -- Photo batching (0.8s debounce for rapid photo bursts) -------------------

const PHOTO_BATCH_MS = 800
const photoBatch: Map<string, {
  timer: ReturnType<typeof setTimeout>
  paths: string[]
  captions: string[]
  messageId: number
  userId: string
  userName: string
  replyContext?: string
  isGroup: boolean
  chatName?: string
}> = new Map()

function flushPhotoBatch(chatId: string): void {
  const batch = photoBatch.get(chatId)
  if (!batch) return
  photoBatch.delete(chatId)

  const count = batch.paths.length
  const caption = batch.captions.filter(Boolean).join('\n')
  const text = caption || `${batch.userName} sent ${count} photo${count > 1 ? 's' : ''}.`

  log(`[batch] Flushing ${count} photo(s) for chat ${chatId}`)

  if (batch.isGroup) {
    const mode = getResponseMode(chatId)
    if (mode === 'selective' || mode === 'mention-only') {
      log(`[filter] Skipping photo batch in ${chatId} -- responseMode=${mode}`)
      return
    }
  }

  startTyping(chatId)
  dispatchMessage({
    chatId,
    messageId: batch.messageId,
    userId: batch.userId,
    userName: batch.userName,
    text,
    attachmentPath: batch.paths.join(','),
    replyContext: batch.replyContext,
    receivedAt: new Date().toISOString(),
    isGroup: batch.isGroup,
    chatName: batch.chatName,
  })
}

bot.on('message:photo', async (ctx) => {
  const chatId = String(ctx.chat.id)
  if (gate(ctx, botUsername) === 'drop') return

  const userId = String(ctx.from.id)
  const userName = ctx.from.first_name || ctx.from.username || 'Unknown'
  const caption = ctx.message.caption || ''
  const replyContext = getReplyContext(ctx)

  lastPollSuccess = Date.now()

  const photo = ctx.message.photo[ctx.message.photo.length - 1]
  let downloadedPath: string | undefined
  try {
    const file = await ctx.api.getFile(photo.file_id)
    const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`
    const ext = file.file_path?.split('.').pop() || 'jpg'
    const localPath = `/tmp/tg-bot/${photo.file_id}.${ext}`
    Bun.spawnSync({ cmd: ['mkdir', '-p', '/tmp/tg-bot'] })
    const resp = await fetch(url)
    await Bun.write(localPath, resp)
    downloadedPath = localPath
    log(`[msg] Photo from ${userName} saved to ${localPath}`)
  } catch (e) {
    log(`[msg] Failed to download photo: ${e}`)
  }

  logMessage(chatId, {
    role: 'user',
    text: caption || '[Photo]',
    user: userName,
    user_id: userId,
    message_id: ctx.message.message_id,
  })

  const existing = photoBatch.get(chatId)
  if (existing) {
    clearTimeout(existing.timer)
    if (downloadedPath) existing.paths.push(downloadedPath)
    if (caption) existing.captions.push(caption)
    existing.timer = setTimeout(() => flushPhotoBatch(chatId), PHOTO_BATCH_MS)
  } else {
    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'
    photoBatch.set(chatId, {
      timer: setTimeout(() => flushPhotoBatch(chatId), PHOTO_BATCH_MS),
      paths: downloadedPath ? [downloadedPath] : [],
      captions: caption ? [caption] : [],
      messageId: ctx.message.message_id,
      userId,
      userName,
      replyContext,
      isGroup,
      chatName: getChatName(chatId),
    })
  }
})

bot.on('message:document', async (ctx) => {
  const chatId = String(ctx.chat.id)
  if (gate(ctx, botUsername) === 'drop') return

  const userId = String(ctx.from.id)
  const userName = ctx.from.first_name || ctx.from.username || 'Unknown'
  const caption = ctx.message.caption || ''
  const fileName = ctx.message.document.file_name || 'document'
  const replyContext = getReplyContext(ctx)

  lastPollSuccess = Date.now()

  let attachmentPath: string | undefined
  try {
    const file = await ctx.api.getFile(ctx.message.document.file_id)
    const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`
    const localPath = `/tmp/tg-bot/${ctx.message.document.file_id}_${fileName}`
    Bun.spawnSync({ cmd: ['mkdir', '-p', '/tmp/tg-bot'] })
    const resp = await fetch(url)
    await Bun.write(localPath, resp)
    attachmentPath = localPath
    log(`[msg] Document "${fileName}" from ${userName} saved to ${localPath}`)
  } catch (e) {
    log(`[msg] Failed to download document: ${e}`)
  }

  logMessage(chatId, {
    role: 'user',
    text: caption || `[Document: ${fileName}]`,
    user: userName,
    user_id: userId,
    message_id: ctx.message.message_id,
  })

  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'

  if (isGroup) {
    const mode = getResponseMode(chatId)
    if (mode === 'selective' || mode === 'mention-only') {
      const mentioned = isMentioned(ctx, botUsername)
      const botNameLower = BOT_NAME.toLowerCase()
      const nameCalled = mode === 'selective' && new RegExp(`\\b${botNameLower}\\b`, 'i').test(caption)
      if (!mentioned && !nameCalled) {
        log(`[filter] Skipping document in ${chatId} -- responseMode=${mode}`)
        return
      }
    }
  }

  startTyping(chatId)

  await dispatchMessage({
    chatId,
    messageId: ctx.message.message_id,
    userId,
    userName,
    text: caption || `User sent a document: ${fileName}`,
    attachmentPath,
    replyContext,
    receivedAt: new Date().toISOString(),
    isGroup,
    chatName: getChatName(chatId),
  })
})

bot.on('message:voice', async (ctx) => {
  const chatId = String(ctx.chat.id)
  if (gate(ctx, botUsername) === 'drop') return

  const userId = String(ctx.from.id)
  const userName = ctx.from.first_name || ctx.from.username || 'Unknown'
  const replyContext = getReplyContext(ctx)
  lastPollSuccess = Date.now()

  let attachmentPath: string | undefined
  try {
    const file = await ctx.api.getFile(ctx.message.voice.file_id)
    const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`
    const localPath = `/tmp/tg-bot/${ctx.message.voice.file_id}.ogg`
    Bun.spawnSync({ cmd: ['mkdir', '-p', '/tmp/tg-bot'] })
    const resp = await fetch(url)
    await Bun.write(localPath, resp)
    attachmentPath = localPath
    log(`[msg] Voice from ${userName} saved to ${localPath}`)
  } catch (e) {
    log(`[msg] Failed to download voice: ${e}`)
  }

  logMessage(chatId, {
    role: 'user',
    text: '[Voice message]',
    user: userName,
    user_id: userId,
    message_id: ctx.message.message_id,
  })

  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'

  if (isGroup) {
    const mode = getResponseMode(chatId)
    if (mode === 'selective' || mode === 'mention-only') {
      const mentioned = isMentioned(ctx, botUsername)
      if (!mentioned) {
        log(`[filter] Skipping voice in ${chatId} -- responseMode=${mode}`)
        return
      }
    }
  }

  startTyping(chatId)

  await dispatchMessage({
    chatId,
    messageId: ctx.message.message_id,
    userId,
    userName,
    text: 'User sent a voice message.',
    attachmentPath,
    replyContext,
    receivedAt: new Date().toISOString(),
    isGroup,
    chatName: getChatName(chatId),
  })
})

// -- Self-watchdog -----------------------------------------------------------

const watchdog = setInterval(() => {
  const staleness = Date.now() - lastPollSuccess
  if (staleness > WATCHDOG_INTERVAL_MS) {
    log(`[watchdog] No successful poll in ${Math.round(staleness / 1000)}s -- exiting for restart`)
    shutdown(1)
  }
}, WATCHDOG_INTERVAL_MS)

// -- Graceful shutdown -------------------------------------------------------

let shuttingDown = false

function shutdown(code = 0): void {
  if (shuttingDown) return
  shuttingDown = true
  log(`[bot] Shutting down (code ${code})...`)

  for (const chatId of typingIntervals.keys()) stopTyping(chatId)
  clearInterval(watchdog)
  stopWarmSession()
  stopReaper()
  bot.stop()
  releaseLock()

  log(`[bot] Shutdown complete`)
  process.exit(code)
}

process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))
process.on('unhandledRejection', (err) => {
  log(`[bot] Unhandled rejection: ${err}`)
})
process.on('uncaughtException', (err) => {
  log(`[bot] Uncaught exception: ${err}`)
  shutdown(1)
})

// -- Start -------------------------------------------------------------------

async function start(): Promise<void> {
  log(`[bot] ${BOT_NAME} standalone bot starting (PID ${process.pid})`)

  const me = await bot.api.getMe()
  botUsername = me.username || ''
  log(`[bot] Logged in as @${botUsername}`)

  try {
    const fallbackIps = await discoverFallbackIps()
    installFallbackTransport(bot, fallbackIps)
  } catch (e) {
    log(`[bot] Fallback IP discovery failed (non-fatal): ${e}`)
  }

  recoverOrphans()
  startReaper()
  startWarmSession()

  try { if (existsSync(CRASH_LOG)) unlinkSync(CRASH_LOG) } catch {}

  log(`[bot] Starting long-polling...`)
  await bot.start({
    onStart: () => {
      lastPollSuccess = Date.now()
      log(`[bot] Polling active -- ${BOT_NAME} is online`)
    },
  })
}

start().catch((err) => {
  log(`[bot] Fatal startup error: ${err}`)
  releaseLock()
  process.exit(1)
})
