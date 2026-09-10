/**
 * 同源自定义端点的最小 fetch 封装（各插件 client/api.ts 的公共收编版）。
 * 仅同源（credentials: same-origin），错误统一抛 Error(body.error)。
 *
 * 运行期校验：`res.json() as T` 是纯断言——服务端契约漂移、中间层插入错误页、
 * 或宿主版本不匹配时，错误结构会一路流到渲染期才炸（典型的白屏）。故 getJson/
 * postJson 接受**可选** guard，调用方对结构性 payload 传入手写类型谓词即可在
 * 边界 fail-fast。不强制：既有调用点可逐步迁移，避免一次性大改。
 * @module @dsh-plus/shared/client/fetch
 */

/** 载荷类型谓词（手写收窄，无 schema 依赖）。 */
export type PayloadGuard<T> = (value: unknown) => value is T

async function parse<T>(res: Response, guard?: PayloadGuard<T>): Promise<T> {
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  if (guard !== undefined && !guard(body)) {
    throw new Error(`响应结构不符合预期（${res.url}）`)
  }
  return body
}

/** GET 同源 JSON 端点。 */
export async function getJson<T>(route: string, guard?: PayloadGuard<T>): Promise<T> {
  return parse<T>(await fetch(route, { credentials: 'same-origin' }), guard)
}

/** POST 同源 JSON 端点（body 可省略）。 */
export async function postJson<T>(
  route: string,
  body?: unknown,
  guard?: PayloadGuard<T>,
): Promise<T> {
  return parse<T>(
    await fetch(route, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      // 条件展开而非 body: undefined——exactOptionalPropertyTypes 下二者类型不同，
      // 语义上「省略 body」也不等于「显式传 undefined」。
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    guard,
  )
}
