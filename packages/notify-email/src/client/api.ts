/**
 * 自定义端点通道：仅剩「发送测试邮件」（配置读写经 ctx.remote.settings
 * 直连，见 shared/client scope.ts 与 card.tsx）。
 * @module notify-email/client/api
 */

export interface TestResult {
  ok: boolean
  detail: string
}

const ROUTE_TEST = '/dsh-plus/notify-email/test'

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body
}

export async function sendTest(): Promise<TestResult> {
  return parse<TestResult>(await fetch(ROUTE_TEST, { method: 'POST', credentials: 'same-origin' }))
}
