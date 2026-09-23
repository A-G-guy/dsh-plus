/**
 * 浏览器半：修复非 loopback 页面下官方设置平面（settings describe mirror）不可用。
 *
 * 背景（0.1.7-alpha.2 基线）：服务端设置 RPC 可达性由统一 /api 信任围栏
 * （loopback 或 --trusted-host 声明的 authority）+ 浏览器令牌 cookie 认证把关；
 * 但浏览器侧 dsh-client-ui-settings 仍按 `remote.$host.isLoopback`（纯页面
 * hostname 判定）选择持久化——域名/LAN IP 访问的页面把共享 describe mirror 与
 * configForms 一起构造成 memory 模式，永不发起 settings.describe，所有派生面无数据：
 *   - 设置 → 模型：「加载提供方目录失败: settings are unavailable in this browser」；
 *   - 插件配置卡片：插件页按 mirror 视图（whileServed）配对，无视图不渲染；
 *   - 启动期已 get() 的官方表单（chat/composer/agent-loop/welcome 等）钉死 memory：
 *     不订阅 mirror、写入被 enqueue 拦截，仅翻 mirror 无法自愈。
 *
 * 本插件部署形态前提：dsh 前置 loopback-rewrite 反代（如 dsh-proxy：Host 改写为
 * 127.0.0.1、删除 Origin 后转发）或声明 --trusted-host，服务端围栏因此放行且
 * cookie 认证可完成。修复策略：探测 `ctx.remote.settings.describe()` 真实可达
 * （可达 ⟺ 服务端会接受本页请求），把 configForms/mirror 的 persistence 从
 * memory 翻回 host、原地修复启动期已构造的 memory 表单，并触发一次 mirror.load()；
 * 不可达（直连且围栏未放行）维持官方降级，不做任何改动。
 *
 * 漂移面（0.1.7-alpha.2 构建产物复核，全部按可选面探测、缺失即对应阶段 no-op）：
 *   - ConfigForms：persistence 属性、describe()→mirror、forms Map；
 *   - SettingsDescribeMirror：persistence 属性、load()、subscribe()；
 *   - ConfigFormController：persistence 属性、store.update()、derive()；
 *   - developerTools：scope/local/enabled 三元组（enabled 与 local 同一才覆写）。
 *
 * 构建产物须为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory
 * （包装见 tsdown.config.ts 的 banner/footer）。零运行时依赖。
 * @module @dsh-plus/remote-settings/client
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-plus-remote-settings'

/** 浏览器半需要的 cordis 服务 key（package.json 的 dsh.client.inject 管包加载顺序）。 */
export const inject = ['remote', 'remote.settings', 'configForms'] as const

/** 官方 SettingsDescribeMirror 快照的最小投影。 */
export interface MirrorSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  view: unknown
  error: string | null
}

/** 官方 SettingsDescribeMirror 的最小漂移面。 */
export interface MirrorLike {
  /** 并上 undefined：判定处按 `persistence === 'memory'` 取值，缺席与 undefined 等价。 */
  persistence?: string | undefined
  getSnapshot(): MirrorSnapshot
  load?(): Promise<void>
  /** 快照订阅（表单修复用）；缺失则只修 mirror 与后续表单。 */
  subscribe?(listener: () => void): () => void
}

/** ctx.remote.settings.describe 的最小面（无参、直返 {ok,...}，失败 throw）。 */
export interface SettingsApiLike {
  describe(): Promise<{ ok: boolean }>
}

/** 官方 ConfigFormController 快照的最小投影。 */
export interface FormSnapshotLike {
  mode?: string | undefined
  status?: string | undefined
  value?: unknown
}

/** 官方 ConfigFormController 的最小漂移面（启动期已构造的 memory 表单修复）。 */
export interface FormLike {
  persistence?: string | undefined
  getSnapshot(): FormSnapshotLike
  store?:
    | { update(fn: (draft: FormSnapshotLike & Record<string, unknown>) => void): void }
    | undefined
  derive?(): void
  subscribe?(listener: () => void): () => void
  unsubscribe?: (() => void) | undefined
}

/** developerTools 偏好（ConfigForms 构造期建出的第一个表单消费者）。 */
export interface DevToolsLike {
  scope?: FormLike | undefined
  local?: { getSnapshot(): unknown; subscribe(listener: () => void): () => void } | undefined
  enabled?: unknown
}

/** 官方 ConfigForms 服务的最小漂移面（0.1.7 起取代 settingsScope）。 */
export interface ConfigFormsLike {
  persistence?: string | undefined
  describe?(): MirrorLike
  forms?: Map<string, FormLike> | undefined
  developerTools?: DevToolsLike | undefined
}

export interface RepairDeps {
  settings: SettingsApiLike
  forms: ConfigFormsLike
}

/**
 * 探测设置 RPC 可达性：可达 ⟺ 请求经围栏放行（反代改写 Host 或 --trusted-host
 * 声明）且带有效浏览器令牌 cookie 被接受。describe 无参、直返；任何抛错/ok:false
 * 都视为不可达。
 */
async function settingsRpcReachable(settings: SettingsApiLike): Promise<boolean> {
  try {
    return (await settings.describe()).ok
  } catch {
    return false
  }
}

/**
 * 启动期已构造的 memory 表单修复：翻 persistence、快照翻成 host 在途态、补订阅
 * 与首次 derive。面缺失的表单跳过（维持上游行为），developerTools 的本地偏好
 * 在 scope 修复成功后原地覆写为 Host 语义。
 */
function repairExistingForms(mirror: MirrorLike, forms: ConfigFormsLike): void {
  const map = forms.forms
  if (map !== undefined && typeof map.values === 'function') {
    for (const form of map.values()) {
      if (form.persistence !== 'memory') continue
      if (form.store === undefined || typeof form.store.update !== 'function') continue
      if (typeof form.derive !== 'function' || typeof mirror.subscribe !== 'function') continue
      form.persistence = 'host'
      form.store.update((draft) => {
        draft.mode = 'host'
        draft.status = 'loading'
      })
      form.unsubscribe = mirror.subscribe(() => form.derive?.())
      form.derive()
    }
  }
  repairDeveloperTools(forms)
}

/**
 * developerTools 偏好恢复：boot 期按 memory 构造时 enabled 与 local 是同一对象，
 * 组件在启动时按引用捕获——因此不换对象，原地把 local 的读/订阅改挂到已修复的
 * Host 表单上，让所有已捕获引用同步恢复。任一面不符（漂移/未修复）即跳过。
 */
function repairDeveloperTools(forms: ConfigFormsLike): void {
  const devTools = forms.developerTools
  if (devTools === undefined) return
  const { scope, local, enabled } = devTools
  if (scope === undefined || local === undefined || enabled !== local) return
  if (typeof scope.subscribe !== 'function' || typeof local.subscribe !== 'function') return
  if (typeof scope.getSnapshot !== 'function' || typeof local.getSnapshot !== 'function') return
  if (scope.getSnapshot().mode !== 'host') return
  const readHost = (): unknown =>
    (scope.getSnapshot().value as { enabled?: boolean } | undefined)?.enabled ?? false
  // 守卫后捕获为局部常量：回调内二次读属性会按 possibly-undefined 重判。
  const subscribe = scope.subscribe
  local.getSnapshot = readHost
  local.subscribe = (listener) => {
    let previous = readHost()
    return subscribe(() => {
      const next = readHost()
      if (next === previous) return
      previous = next
      listener()
    })
  }
}

/**
 * 核心修复：非 memory 降级态不动；探测可达后把 configForms/mirror 翻回 host、
 * 修复启动期已构造的表单并触发一次加载。返回是否发生了修复。
 * 任何前置条件/漂移面不命中都为无操作（维持官方行为）。
 */
export async function maybeRepairSettingsPlane(deps: RepairDeps): Promise<boolean> {
  const { forms, settings } = deps
  if (forms.persistence !== 'memory') return false
  if (typeof forms.describe !== 'function') return false
  const mirror = forms.describe()
  if (mirror.persistence !== 'memory') return false
  // 上游漂移防御：无 load() 面则无法触发加载，维持降级且不发起探测
  if (typeof mirror.load !== 'function') return false
  if (!(await settingsRpcReachable(settings))) return false
  // 探测期间状态可能被其他途径改变，复核后再翻
  if (forms.persistence !== 'memory' || mirror.persistence !== 'memory') return false
  forms.persistence = 'host'
  mirror.persistence = 'host'
  repairExistingForms(mirror, forms)
  await mirror.load()
  return true
}

interface RemoteLike {
  settings: SettingsApiLike
}

interface ClientContext {
  get(key: 'remote'): RemoteLike | undefined
  get(key: 'configForms'): ConfigFormsLike | undefined
}

export function apply(ctx: Context): void {
  const c = ctx as unknown as ClientContext
  const remote = c.get('remote')
  const forms = c.get('configForms')
  if (remote === undefined || forms === undefined) return
  void maybeRepairSettingsPlane({ settings: remote.settings, forms })
    .then((repaired) => {
      if (repaired) {
        console.info(
          '[dsh-plus] remote-settings: 检测到 settings RPC 可达，describe mirror 与 configForms 已从 memory 降级修复为 host 模式',
        )
      }
    })
    .catch((error: unknown) => {
      console.error('[dsh-plus] remote-settings: settings 平面修复失败', error)
    })
}
