/**
 * Telegram API fallback IP transport.
 *
 * Discovers alternate Telegram API IPs via DNS-over-HTTPS (Google + Cloudflare),
 * then installs a grammy API transformer that retries failed requests through
 * fallback IPs with sticky selection.
 *
 * Handles: Mac sleep, VPN switches, ISP DNS outages, Telegram endpoint failures.
 */

import type { Bot } from 'grammy'
import { resolve } from 'dns/promises'

const TG_API_HOST = 'api.telegram.org'
const SEED_FALLBACK_IPS = ['149.154.167.220']
const DOH_TIMEOUT_MS = 4000

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stdout.write(line)
}

/** Query DNS-over-HTTPS for A records */
async function queryDoH(url: string, params: Record<string, string>, headers: Record<string, string> = {}): Promise<string[]> {
  try {
    const qs = new URLSearchParams(params).toString()
    const resp = await fetch(`${url}?${qs}`, {
      headers,
      signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
    })
    if (!resp.ok) return []
    const data = await resp.json() as any
    const ips: string[] = []
    for (const answer of data.Answer || []) {
      if (answer.type !== 1) continue
      const ip = String(answer.data || '').trim()
      if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) ips.push(ip)
    }
    return ips
  } catch {
    return []
  }
}

/** Resolve system DNS for comparison */
async function systemResolve(): Promise<Set<string>> {
  try {
    const addrs = await resolve(TG_API_HOST)
    return new Set(addrs)
  } catch {
    return new Set()
  }
}

/** Discover fallback IPs via DNS-over-HTTPS (Google + Cloudflare) */
export async function discoverFallbackIps(): Promise<string[]> {
  const [systemIps, googleIps, cloudflareIps] = await Promise.all([
    systemResolve(),
    queryDoH('https://dns.google/resolve', { name: TG_API_HOST, type: 'A' }),
    queryDoH('https://cloudflare-dns.com/dns-query', { name: TG_API_HOST, type: 'A' }, { Accept: 'application/dns-json' }),
  ])

  const seen = new Set<string>()
  const candidates: string[] = []
  for (const ip of [...googleIps, ...cloudflareIps]) {
    if (!seen.has(ip) && !systemIps.has(ip)) {
      seen.add(ip)
      candidates.push(ip)
    }
  }

  for (const ip of systemIps) {
    if (!seen.has(ip)) {
      seen.add(ip)
      candidates.push(ip)
    }
  }

  if (candidates.length > 0) {
    log(`[fallback] Discovered ${candidates.length} Telegram API IPs: ${candidates.join(', ')}`)
    return candidates
  }

  log(`[fallback] DoH discovery yielded no IPs, using seed: ${SEED_FALLBACK_IPS.join(', ')}`)
  return [...SEED_FALLBACK_IPS]
}

function isTransientConnectError(e: any): boolean {
  const msg = String(e?.message || e || '').toLowerCase()
  return msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('enetunreach') ||
    msg.includes('ehostunreach') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('dns')
}

/**
 * Install fallback IP transformer on a grammy bot.
 * On connect failure, retries the API call through alternate IPs.
 */
export function installFallbackTransport(bot: Bot, fallbackIps: string[]): void {
  if (fallbackIps.length === 0) return

  let stickyIp: string | null = null
  let consecutiveFailures = 0

  bot.api.config.use(async (prev, method, payload, signal) => {
    const attemptOrder: (string | null)[] = []
    if (stickyIp) attemptOrder.push(stickyIp)
    attemptOrder.push(null)
    for (const ip of fallbackIps) {
      if (ip !== stickyIp) attemptOrder.push(ip)
    }

    let lastError: any = null
    for (const ip of attemptOrder) {
      try {
        let result: any
        if (ip === null) {
          result = await prev(method, payload, signal)
        } else {
          const url = `https://${ip}/bot${bot.token}/${method}`
          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Host': TG_API_HOST,
            },
            body: JSON.stringify(payload),
            signal: signal || AbortSignal.timeout(30000),
            // @ts-ignore -- Bun supports this for TLS SNI
            tls: { serverName: TG_API_HOST },
          })
          result = await resp.json()
        }

        if (ip !== null && stickyIp !== ip) {
          stickyIp = ip
          log(`[fallback] Sticky IP set to ${ip}`)
        }
        if (ip === null && stickyIp !== null) {
          log(`[fallback] Primary API recovered, clearing sticky IP`)
          stickyIp = null
        }
        consecutiveFailures = 0
        return result
      } catch (e: any) {
        lastError = e
        if (!isTransientConnectError(e)) throw e
        log(`[fallback] ${ip || 'primary'} failed: ${e?.message}`)
        continue
      }
    }

    consecutiveFailures++
    if (consecutiveFailures >= 5) {
      log(`[fallback] ${consecutiveFailures} consecutive failures -- all IPs exhausted`)
    }
    throw lastError
  })

  log(`[fallback] Installed with ${fallbackIps.length} fallback IP(s)`)
}
