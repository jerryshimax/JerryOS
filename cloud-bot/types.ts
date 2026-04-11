/** Shared types for standalone Telegram bot */

export interface Job {
  id: string
  pid: number
  chatId: string
  messageId?: number
  userName: string
  startedAt: string
  timeout: number
  logPath: string
  status: 'running' | 'completed' | 'failed' | 'timeout'
  sentViaMcp: boolean // true if claude -p already sent reply via MCP send_message
}

export interface JobManifest {
  [jobId: string]: Job
}

export interface QueuedMessage {
  chatId: string
  messageId: number
  userId: string
  userName: string
  text: string
  attachmentPath?: string
  replyContext?: string // text of the message being replied to
  receivedAt: string
}

export interface Access {
  dmPolicy: 'pairing' | 'allowlist' | 'disabled'
  allowFrom: string[]
  groups: Record<string, GroupPolicy>
  pending: Record<string, unknown>
  mentionPatterns?: string[]
  ackReaction?: string
  replyToMode?: 'off' | 'first' | 'all'
  textChunkLimit?: number
}

export interface GroupPolicy {
  name?: string
  allowed?: boolean
  requireMention?: boolean
  responseMode?: 'always' | 'selective' | 'mention-only'
  allowFrom?: string[]
}

export interface WarmRequest {
  chatId: string
  messageId: number
  userName: string
  text: string
  chatRules: string
  isGroup: boolean
  chatName?: string
  attachmentPath?: string
  replyContext?: string
}

export interface WarmResult {
  text: string
  sentViaMcp: boolean
}
