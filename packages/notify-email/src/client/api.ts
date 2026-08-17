/**
 * 配置卡片数据通道：同源 fetch 调自建 webServer 路由。
 * （官方 settings.* RPC 白名单硬编码不含第三方 namespace，见 config-api.ts 注释。）
 * @module notify-email/client/api
 */

export interface WireSmtp {
  host: string
  port: number
  secure: boolean
  user: string
  from: string
  passConfigured: boolean
}

export interface WireTriggers {
  onComplete: boolean
  onError: boolean
  onAborted: boolean
  onQuestion: boolean
  onPlanReview: boolean
}

export interface WireConfig {
  enabled: boolean
  smtp: WireSmtp
  to: string[]
  triggers: WireTriggers
  idleDebounceMs: number
  maxBodyChars: number
  dryRun: boolean
  writable: boolean
}

export interface WirePatch {
  enabled: boolean
  smtp: {
    host: string
    port: number
    secure: boolean
    user: string
    pass: string
    from: string
  }
  to: string[]
  triggers: WireTriggers
  idleDebounceMs: number
  maxBodyChars: number
  dryRun: boolean
}

export interface TestResult {
  ok: boolean
  detail: string
}

const ROUTE_CONFIG = '/dsh-plus/notify-email/config'
const ROUTE_TEST = '/dsh-plus/notify-email/test'

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body
}

export async function fetchConfig(): Promise<WireConfig> {
  return parse<WireConfig>(await fetch(ROUTE_CONFIG, { credentials: 'same-origin' }))
}

export async function saveConfig(patch: WirePatch): Promise<WireConfig> {
  return parse<WireConfig>(
    await fetch(ROUTE_CONFIG, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  )
}

export async function sendTest(): Promise<TestResult> {
  return parse<TestResult>(await fetch(ROUTE_TEST, { method: 'POST', credentials: 'same-origin' }))
}
