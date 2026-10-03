/**
 * dsh 插件：内置重新加载。
 * 默认路径是**进程内重载**（`/reload`、设置页「重新加载」）：读盘重建 profile
 * 组合层并对账进运行中的 Loader 树——行启停、行配置、组合包选择、settings 与
 * 新增条目即时生效，零中断，且不需要刷新页面（客户端插件图由官方
 * dsh-client-hmr 同步）。同时比对 profile 直接依赖的产物指纹，把「位于
 * node_modules、上游热重载不替换、只能重启」的包点名报告。
 *
 * systemd 重启保留为显式出口（`/reload restart`、设置页「重启服务」），供
 * 插件本体替换、平台升级、.env 变更等进程内无法覆盖的场景；它沿用
 * `sudo systemctl restart --no-block` + 浏览器轮询 bootId 后自动刷新。
 *
 * 安全边界：重启通道在非 systemd 托管 / 单元非 active / sudo 免密缺失时一律
 * 拒绝；进程内重载在有 running 会话时需显式 force（对应 pi 的「等当前响应
 * 结束」）。无持久态，进程重启即回到 idle。
 *
 * 与 lifeboat 的关系：不联动代码——重启后若兄弟插件加载失败，
 * lifeboat 既有隔离机制自动止血；本插件自身亦在其 dsh-plus-* 守护范围内。
 * @module @dsh-plus/reload
 */
import type { Context } from '@deepseek-ai/cordis'
// 平台面：profile 组合层读取与对账（官方公开导出；dsh-config-editor /
// dsh-plugin-manager 同款用法），以及 profileContext / pluginPackages 的服务类型。
import { readProfilePatches, reconcileProfilePatches } from '@deepseek-ai/dsh-app-boot'
// 类型面：注册 Context 上的 hmr 服务（模块增强），使 ctx.inject(['hmr']) 可类型检查。
import type Hmr from '@deepseek-ai/dsh-hmr'

import { agentsOf, countRunning } from './agents.ts'
import { type CommandDeps, registerReloadCommand } from './command.ts'
import { Config, type ReloadConfig } from './config.ts'
import {
  type InProcessCapabilities,
  type InProcessOutcome,
  runInProcessReload,
  unsupportedReasons,
} from './inprocess.ts'
import { createPendingRestart } from './pending.ts'
import { type PreflightEnv, type PreflightResult, runPreflight, systemRunner } from './preflight.ts'
import { type ApplyReport, applyReport, statusText } from './report.ts'
import { registerReloadRoutes } from './routes.ts'
import { ReloadScheduler } from './scheduler.ts'

export const name = 'dsh-plus-reload'

export { Config }

/**
 * pluginPackages 服务的窄面：只需要「刷新运行时包解析表」。
 * 该方法的类型面在 0.2.0-rc.1 尚未出现（0.2.1-alpha.1 才有），故按运行期契约探测，
 * 缺席即视为无此能力（报告里显示 pluginPackages ✗），不影响其余重载路径。
 */
interface PluginPackagesLike {
  refresh?: () => Promise<void>
}

/** profile 组合层重建的 patch 列表类型（由官方导出函数推导，避免额外类型依赖）。 */
type PatchList = ReturnType<typeof readProfilePatches>

/**
 * 读取「祖先上下文」提供的可选服务：宿主在 boot 的 prepare 阶段挂在根上下文的服务
 * （如 pluginPackages）可由此读到；**行内服务**（同级行提供的 hmr/webServer/commands
 * 等）用 `ctx.get` 恒为 undefined，必须走 `ctx.inject` 回调。返回 undefined 表示
 * 该能力缺席，由调用方降级。
 * @param ctx - 插件上下文。
 * @param name - 服务名。
 * @returns 服务实例；未提供或未激活时为 undefined。
 */
function optionalService<T>(ctx: Context, name: string): T | undefined {
  const loose = ctx as unknown as { get(key: string, strict?: boolean): unknown }
  return loose.get(name) as T | undefined
}

export function apply(ctx: Context, config: ReloadConfig): void {
  if (!config.enabled) return
  const logger = ctx.logger('reload')
  const onError = (message: string): void => logger.warn(message)

  const scheduler = new ReloadScheduler({
    unitName: config.unitName,
    confirmTokenTtlMs: config.confirmTokenTtlMs,
    serverGraceMs: config.serverGraceMs,
    onError,
  })

  // agents 服务缺席（非交互组合）时降级为 0：running 防线仅在能观测时生效。
  let runningAgents = (): number => 0
  ctx.inject(['agents'], (agentCtx) => {
    runningAgents = () => countRunning(agentsOf(agentCtx))
  })

  const profile = ctx.get('profileContext')
  const profileDir = profile?.dir

  // hmr 是行内服务（非宿主 provide）：属性访问与 ctx.get 都要求先声明 inject，
  // 而它对我们是可选依赖（没有 HMR 的组合必须照常加载），故用 inject 回调按需捕获；
  // 回调会在服务就绪时执行，因此这里读到的是「用时」的值。
  let hmr: Hmr | undefined
  ctx.inject(['hmr'], (hmrCtx) => {
    hmr = hmrCtx.hmr
  })

  // pluginPackages 由宿主在 boot 的 prepare 阶段直接挂在根上下文，属祖先服务，
  // ctx.get 可见；refresh 的类型面在 0.2.0-rc.1 尚未出现，按运行期契约探测。
  const refreshPackagesOf = (): (() => Promise<void>) | undefined => {
    const packages = optionalService<PluginPackagesLike>(ctx, 'pluginPackages')
    return packages?.refresh?.bind(packages)
  }

  // 环境能力事实（进程内静态）：桌面端 desktop profile / 非 Linux 平台在
  // 重启预检阶段即给平台化拒绝理由，不触碰不存在的 systemctl/sudo。
  const preflightEnv: PreflightEnv = { profileName: profile?.name }
  const preflight = (): Promise<PreflightResult> =>
    runPreflight(config.unitName, process.pid, systemRunner, preflightEnv)

  const capabilities = (): InProcessCapabilities => ({
    profile: profile !== undefined,
    hmr: hmr !== undefined,
    pluginPackages: refreshPackagesOf() !== undefined,
  })

  // 产物指纹基线：本进程启动时 profile 直接依赖的构建产物内容哈希。
  const pending = createPendingRestart({
    binName: config.binName,
    profileDir,
    enabled: config.detectPendingRestart,
    onError,
  })

  const runInProcess = async (): Promise<InProcessOutcome> => {
    if (profile === undefined) {
      return { kind: 'unsupported', reasons: unsupportedReasons(capabilities()) }
    }
    const exclusive = hmr
    return runInProcessReload<PatchList>({
      capabilities: capabilities(),
      refreshPackages: refreshPackagesOf(),
      readPatches: () => readProfilePatches(config.binName, profile),
      reconcile: (patches) => reconcileProfilePatches(ctx.root, patches, config.binName),
      exclusive:
        exclusive === undefined ? undefined : (operation) => exclusive.runExclusive(operation),
    })
  }

  const apply: (options: { force: boolean }) => Promise<ApplyReport> = (options) =>
    applyReport(
      {
        capabilities,
        run: runInProcess,
        pendingRestart: pending.changed,
        runningAgents: () => runningAgents(),
      },
      options,
    )

  const status = (): Promise<string> =>
    statusText({
      capabilities,
      pendingRestart: pending.changed,
      runningAgents: () => runningAgents(),
      preflight,
      schedulerState: () => scheduler.getState(),
      bootId: scheduler.bootId,
    })

  const commandDeps: CommandDeps = {
    apply,
    status,
    scheduler,
    preflight,
    runningAgents: () => runningAgents(),
  }

  ctx.inject(['commands'], (commandCtx) => {
    registerReloadCommand(commandCtx, commandDeps)
  })

  ctx.inject(['webServer'], (webCtx) => {
    registerReloadRoutes(webCtx, {
      scheduler,
      config,
      apply,
      runningAgents: () => runningAgents(),
      onError,
      preflightEnv,
    })
  })
}
