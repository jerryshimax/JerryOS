/**
 * Prompt builder -- constructs the prompt for claude -p subprocesses.
 * Injects chat history, per-chat rules, and the current message.
 *
 * Customize the system prompt in buildPrompt() and the warm session prompt
 * in warm-session.ts to match your bot's personality and capabilities.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getRecentHistory } from './history'

// TODO: Point this to your chat rules file (optional)
// This file defines per-chat access rules, response modes, etc.
const CHAT_RULES_PATH = process.env.CHAT_RULES_PATH || ''

// Optional: a markdown file with operating context for the bot
const BOT_CONTEXT_PATH = join(import.meta.dir, 'bot-context.md')

const BOT_NAME = process.env.BOT_NAME || 'Assistant'

let cachedChatRules: string | null = null
let chatRulesCacheTime = 0
let cachedBotContext: string | null = null
let botContextCacheTime = 0
const CACHE_TTL_MS = 60_000

function loadChatRules(): string {
  if (!CHAT_RULES_PATH) return ''
  const now = Date.now()
  if (cachedChatRules && now - chatRulesCacheTime < CACHE_TTL_MS) return cachedChatRules
  try {
    cachedChatRules = readFileSync(CHAT_RULES_PATH, 'utf8')
    chatRulesCacheTime = now
    return cachedChatRules
  } catch {
    return ''
  }
}

export function loadBotContext(): string {
  const now = Date.now()
  if (cachedBotContext && now - botContextCacheTime < CACHE_TTL_MS) return cachedBotContext
  try {
    cachedBotContext = readFileSync(BOT_CONTEXT_PATH, 'utf8')
    botContextCacheTime = now
    return cachedBotContext
  } catch {
    return ''
  }
}

export function extractChatRules(chatId: string): string {
  const rules = loadChatRules()
  if (!rules) return ''

  // Always include general rules
  const generalMatch = rules.match(/## General Rules[\s\S]*?(?=\n---|\n## [A-Z])/i)
  const general = generalMatch ? generalMatch[0].trim() : ''

  // Find the specific chat section by chat ID
  const chatIdPattern = new RegExp(
    `## [^\\n]+\\n[\\s\\S]*?\\*\\*Chat ID:\\*\\*\\s*${chatId.replace('-', '\\-')}[\\s\\S]*?(?=\\n---\\n|$)`,
    'i'
  )
  const chatMatch = rules.match(chatIdPattern)
  const chatSection = chatMatch ? chatMatch[0].trim() : ''

  if (!chatSection) return general
  return `${general}\n\n${chatSection}`
}

export interface PromptParams {
  chatId: string
  userId: string
  userName: string
  text: string
  attachmentPath?: string
  isGroup: boolean
  chatName?: string
}

export function buildPrompt(params: PromptParams): string {
  const { chatId, userId, userName, text, attachmentPath, isGroup, chatName } = params

  const history = getRecentHistory(chatId, 100)
  const chatRules = extractChatRules(chatId)
  const today = new Date().toISOString().split('T')[0]

  const parts: string[] = []

  const botContext = loadBotContext()
  if (botContext) {
    parts.push(`<operating_context>\n${botContext}\n</operating_context>`)
  }

  // TODO: Customize this system prompt for your bot's personality
  parts.push(`You are ${BOT_NAME}, an AI assistant on Telegram.

Your response text will be sent directly to Telegram as the reply. Write your response as the message itself -- no wrapping, no meta-commentary.`)

  parts.push(`\n== CHAT CONTEXT ==
Chat ID: ${chatId}${chatName ? ` (${chatName})` : ''}
${isGroup ? 'Group chat' : 'Private DM'}
From: ${userName} (user_id: ${userId})
Date: ${today}`)

  if (chatRules) {
    parts.push(`\n== CHAT RULES (follow these exactly) ==
<chat_rules>
${chatRules}
</chat_rules>`)
  }

  if (history) {
    parts.push(`\n== RECENT CONVERSATION HISTORY (for context only -- do NOT repeat or summarize) ==
<history>
${history}
</history>`)
  }

  parts.push(`\n== CURRENT MESSAGE ==
${userName}: ${text}`)

  if (attachmentPath) {
    const paths = attachmentPath.split(',')
    if (paths.length === 1) {
      parts.push(`\n[Attachment saved to: ${attachmentPath}]`)
    } else {
      parts.push(`\n[${paths.length} attachments saved to:]`)
      for (const p of paths) {
        parts.push(`[Attachment: ${p.trim()}]`)
      }
    }
  }

  parts.push(`\n== RESPONSE RULES ==
- Your output text IS the reply. Write it naturally as a Telegram message.
- No markdown formatting (no ###, **, etc.) -- just talk normally.
- Be concise. Telegram is a chat, not an essay.
- Match the language of the conversation.
- If you need to use MCP tools, use them, then write a summary as your response.
- IMPORTANT: Use the send_message MCP tool to send your final reply to chat_id "${chatId}". This ensures delivery even if the parent process restarts.`)

  return parts.join('\n')
}
