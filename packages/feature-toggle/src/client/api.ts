/**
 * 自定义端点通道：状态快照与托管预设重建。
 * 期望态的读写走官方 settings RPC（scope.ts 复用 notify-email 模式）；
 * 这里只承载官方传输没有的两类只读/动作端点。
 * @module feature-toggle/client/api
 */

/** GET /dsh-plus/feature-toggle/state 的响应（EngineState 的传输投影）。 */
export interface ToggleState {
  features: Record<string, boolean>
  effects: Record<
    string,
    {
      desired: boolean
      applied: boolean
      effect: 'immediate' | 'new-session'
      needsBrowserRefresh: boolean
    }
  >
  preset: {
    exists: boolean
    defaultId: string | null
    isDefault: boolean
    broken: string | null
    sourcePresetId: string
  }
  pendingRestart: boolean
  journal: Array<{ at: string; kind: string; detail: string }>
  quarantined: string[]
}

const ROUTE = '/dsh-plus/feature-toggle'

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body
}

export async function fetchState(): Promise<ToggleState> {
  return parse<ToggleState>(
    await fetch(`${ROUTE}/state`, { method: 'GET', credentials: 'same-origin' }),
  )
}

export async function rebuildPreset(sourcePresetId?: string): Promise<void> {
  await parse<{ ok: boolean }>(
    await fetch(`${ROUTE}/rebuild`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(sourcePresetId === undefined ? {} : { sourcePresetId }),
    }),
  )
}
