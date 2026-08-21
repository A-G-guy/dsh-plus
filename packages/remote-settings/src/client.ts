/**
 * 浏览器半：修复非 loopback 页面下官方设置平面（settings describe mirror）不可用。
 *
 * 背景：官方把配置平面（settings / credentials 等 RPC 域）钉死在 loopback——服务端
 * PRIVILEGED_METHODS 空信任列表拦截（Host 头非回环即 403），浏览器侧
 * dsh-client-ui-settings 的共享 describe mirror 在非 loopback 页面直接以
 * memory 模式构造，永不加载。后果（经 tailnet/域名等远程访问时）：
 *   - 设置 → 模型：「加载提供方目录失败: settings are unavailable in this browser」
 *     （ModelsSettingsStore 等不到 mirror 视图）；
 *   - 设置 → 插件 → 插件配置：ConfigurablePluginsTab 按 mirror 视图配对
 *     settings.plugin.item 卡片，无视图则不渲染任何插件自定义卡片。
 *
 * 本插件部署形态前提：dsh 前置 loopback-rewrite 反代（如 dsh-proxy：Host 改写为
 * 127.0.0.1、删除 Origin 后转发），服务端围栏因此放行特权 RPC。缺失的只是浏览器侧
 * mirror 的 memory 降级。修复策略：探测 `settings.describe` 真实可达——可达说明
 * 处于反代之后，把 mirror 的 persistence 从 memory 翻回 host 并触发加载；
 * 不可达（直连 LAN IP 等）维持官方降级，不做任何改动。
 *
 * 注：persistence 是官方类的运行期属性（非公开契约），翻上游实现漂移时
 * （属性缺失/语义变化）探测前置条件自然不命中，插件退化为无操作。
 *
 * 构建产物须为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory
 * （包装见 tsdown.config.ts 的 banner/footer）。零运行时依赖。
 * @module @dsh-plus/remote-settings/client
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-plus-remote-settings'

/** 浏览器半需要的 cordis 服务 key（package.json 的 dsh.client.inject 管包加载顺序）。 */
export const inject = ['connection', 'settingsScope'] as const

/** 官方 SettingsDescribeMirror 快照的最小投影。 */
export interface MirrorSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  view: unknown
  error: string | null
}

/** 官方 SettingsDescribeMirror 的最小面（运行期属性名以 rc8 构建产物为准）。 */
export interface MirrorLike {
  persistence: string
  getSnapshot(): MirrorSnapshot
  load(): Promise<void>
}

/** settings.describe RPC 的最小面（探活一次，读写在 mirror 修复后复用官方通路）。 */
export interface SettingsApiLike {
  describe(payload: Record<string, never>): Promise<{ result: { ok: boolean } }>
}

export interface RepairDeps {
  isLoopback: boolean
  settings: SettingsApiLike
  mirror: MirrorLike
}

/** memory 降级态判定：mirror 以 memory 构造且从未有过视图。 */
function isMemoryDegraded(mirror: MirrorLike): boolean {
  return mirror.persistence === 'memory' && mirror.getSnapshot().status === 'unavailable'
}

/** 探测特权 RPC 可达性：可达 ⟺ 请求经 loopback-rewrite 反代，服务端围栏放行。 */
async function privilegedRpcReachable(settings: SettingsApiLike): Promise<boolean> {
  try {
    return (await settings.describe({})).result.ok
  } catch {
    return false
  }
}

/**
 * 核心修复：非 loopback 页面 + mirror 处于 memory 降级 + 特权 RPC 可达时，
 * 把 mirror 翻回 host 模式并触发一次加载。返回是否发生了修复。
 * 任何前置条件不命中都为无操作（维持官方行为）。
 */
export async function maybeRepairMirror(deps: RepairDeps): Promise<boolean> {
  if (deps.isLoopback) return false
  const { mirror } = deps
  if (!isMemoryDegraded(mirror)) return false
  if (!(await privilegedRpcReachable(deps.settings))) return false
  // 探测期间状态可能被其他途径改变，复核后再翻
  if (!isMemoryDegraded(mirror)) return false
  mirror.persistence = 'host'
  await mirror.load()
  return true
}

interface ConnectionLike {
  isLoopback: boolean
  api: { settings: SettingsApiLike }
}

interface SettingsScopeLike {
  describe(): MirrorLike
}

interface ClientContext {
  get(key: 'connection'): ConnectionLike | undefined
  get(key: 'settingsScope'): SettingsScopeLike | undefined
}

export function apply(ctx: Context): void {
  const c = ctx as unknown as ClientContext
  const connection = c.get('connection')
  const mirror = c.get('settingsScope')?.describe()
  if (connection === undefined || mirror === undefined) return
  void maybeRepairMirror({
    isLoopback: connection.isLoopback,
    settings: connection.api.settings,
    mirror,
  }).then((repaired) => {
    if (repaired) {
      console.info(
        '[dsh-plus] remote-settings: 检测到 loopback-rewrite 反代，settings mirror 已从 memory 降级修复为 host 模式',
      )
    }
  })
}
