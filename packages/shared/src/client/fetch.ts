/**
 * 同源自定义端点的最小 fetch 封装（各插件 client/api.ts 的公共收编版）。
 * 仅同源（credentials: same-origin），错误统一抛 Error(body.error)。
 * @module @dsh-plus/shared/client/fetch
 */

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body
}

/** GET 同源 JSON 端点。 */
export async function getJson<T>(route: string): Promise<T> {
  return parse<T>(await fetch(route, { credentials: 'same-origin' }))
}

/** POST 同源 JSON 端点（body 可省略）。 */
export async function postJson<T>(route: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(route, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}
