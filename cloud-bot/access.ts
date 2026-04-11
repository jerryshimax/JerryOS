/**
 * Access control -- reads shared access.json, gates messages per chat.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Context } from 'grammy'
import type { Access } from './types'

const STATE_DIR = join(homedir(), '.claude', 'channels', 'telegram')
const ACCESS_FILE = join(STATE_DIR, 'access.json')

let cachedAccess: Access | null = null
let cacheTime = 0
const CACHE_TTL_MS = 10_000

function loadAccess(): Access {
  const now = Date.now()
  if (cachedAccess && now - cacheTime < CACHE_TTL_MS) return cachedAccess

  try {
    const raw = readFileSync(ACCESS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Access>
    cachedAccess = {
      dmPolicy: parsed.dmPolicy ?? 'allowlist',
      allowFrom: parsed.allowFrom ?? [],
      groups: parsed.groups ?? {},
      pending: parsed.pending ?? {},
      mentionPatterns: parsed.mentionPatterns,
      ackReaction: parsed.ackReaction,
    }
    cacheTime = now
    return cachedAccess
  } catch {
    return { dmPolicy: 'allowlist', allowFrom: [], groups: {}, pending: {} }
  }
}

export type GateResult = 'deliver' | 'drop'

export function gate(ctx: Context, botUsername: string): GateResult {
  const access = loadAccess()
  const from = ctx.from
  if (!from) return 'drop'

  const senderId = String(from.id)
  const chatType = ctx.chat?.type
  const chatId = String(ctx.chat?.id)

  // Private DM
  if (chatType === 'private') {
    if (access.allowFrom.includes(senderId)) return 'deliver'
    return 'drop'
  }

  // Group / supergroup
  if (chatType === 'group' || chatType === 'supergroup') {
    const policy = access.groups[chatId]
    if (!policy) return 'drop'
    if (policy.allowed === false) return 'drop'

    const groupAllowFrom = policy.allowFrom ?? []
    if (groupAllowFrom.length > 0 && !groupAllowFrom.includes(senderId)) return 'drop'

    const requireMention = policy.requireMention ?? true
    if (requireMention && !isMentioned(ctx, botUsername, access.mentionPatterns)) return 'drop'

    return 'deliver'
  }

  return 'drop'
}

export function getResponseMode(chatId: string): 'always' | 'selective' | 'mention-only' {
  const access = loadAccess()
  const policy = access.groups[chatId]
  return policy?.responseMode ?? 'always'
}

export function isMentioned(ctx: Context, botUsername: string, extraPatterns?: string[]): boolean {
  const entities = ctx.message?.entities ?? ctx.message?.caption_entities ?? []
  const text = ctx.message?.text ?? ctx.message?.caption ?? ''

  for (const e of entities) {
    if (e.type === 'mention') {
      const mentioned = text.slice(e.offset, e.offset + e.length)
      if (mentioned.toLowerCase() === `@${botUsername}`.toLowerCase()) return true
    }
    if (e.type === 'text_mention' && e.user?.is_bot && e.user.username === botUsername) return true
  }

  // Reply to bot's message
  if (ctx.message?.reply_to_message?.from?.username === botUsername) return true

  // Extra mention patterns from access.json
  for (const pat of extraPatterns ?? []) {
    try { if (new RegExp(pat, 'i').test(text)) return true } catch {}
  }

  return false
}
