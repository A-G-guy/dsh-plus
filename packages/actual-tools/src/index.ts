/**
 * dsh-plus 子插件：把主插件（@dsh-plus/actual）发现的 Actual 能力清单注册为
 * **agent 作用域**的 DSH 工具——只在 `actual` 预设内可见，不污染其他预设。
 *
 * 行为（对齐思源子插件）：
 * - 惰性等待首次发现（有界、自吞失败），随后监听清单变更整代换新；
 *   发现失败按 5s→60s 指数退避重试，Actual 未部署不影响预设激活；
 * - `tools/pre-execute` 写确认接入 DSH 官方审批体系：policy=ask 才弹窗，
 *   never（完全权限/无人值守）直接放行——ask 绝不静默降级为拒绝；
 * - system-prompt 动态环境快照（日期 + CLI/服务端版本 + 连接事实）。
 *
 * 与思源的差异：Actual 侧没有「写前快照」API，因此**不发明假备份**——写入保护
 * 由审批、提示词里的 `dryRun` 指引与官方同步历史承担。
 * @module @dsh-plus/actual-tools
 */
import type { Context } from '@deepseek-ai/cordis'

import { type ActualToolsConfig, Config } from './config.ts'
import { registerEnvContext } from './env.ts'
import { policySettingsOf, registerPolicy } from './policy.ts'
import { applyManifest, emptyToolState, type RegisterDeps, type ToolState } from './register.ts'

export const name = 'dsh-plus-actual-tools'

/** 依赖宿主 `actual` 服务与 `tools` 注册表；缺席时按「等待服务」挂起。 */
export const inject = ['actual', 'tools'] as const

export type { ActualToolsConfig }
export { Config }

const RETRY_BASE_MS = 5_000
const RETRY_MAX_MS = 60_000

/** 提取错误文本。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 发现同步循环：单飞 + 指数退避重试，首次失败自吞（永不使激活失败）。 */
function createSyncer(deps: RegisterDeps, state: ToolState) {
  const logger = deps.ctx.logger('actual-tools')
  let disposed = false
  let syncing: Promise<void> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelayMs = RETRY_BASE_MS

  const scheduleRetry = (): void => {
    if (disposed || retryTimer !== undefined) return
    const delay = retryDelayMs
    retryDelayMs = Math.min(delay * 2, RETRY_MAX_MS)
    const timer = setTimeout(() => {
      retryTimer = undefined
      if (!disposed) void sync()
    }, delay)
    timer.unref?.()
    retryTimer = timer
  }

  const sync = (): Promise<void> => {
    if (syncing !== undefined) return syncing
    syncing = (async () => {
      try {
        const manifest = await deps.ctx.actual.discover()
        if (disposed) return
        applyManifest(deps, manifest, state)
        retryDelayMs = RETRY_BASE_MS
        logger.info(
          `actual tools synced: ${state.disposers.size} tools (source=${manifest.source})`,
        )
      } catch (error) {
        if (disposed) return
        logger.warn(`Actual capability discovery failed, retry scheduled: ${messageOf(error)}`)
        scheduleRetry()
      } finally {
        syncing = undefined
      }
    })()
    return syncing
  }

  return {
    sync,
    stop(): void {
      disposed = true
      if (retryTimer !== undefined) clearTimeout(retryTimer)
    },
  }
}

/** 注销整代工具并复位状态。 */
function disposeTools(state: ToolState): void {
  for (const dispose of state.disposers.values()) dispose()
  state.disposers = new Map()
  state.owned = new Map()
}

/**
 * 装配：先同步挂好监听/策略/清理，再等待首次发现。
 * 首次发现自吞失败（记 warn 并排重试），因此永不使激活失败。
 * @param ctx - 预设作用域上下文。
 * @param config - 已验证的行级配置。
 */
export async function apply(ctx: Context, config: ActualToolsConfig): Promise<void> {
  const state = emptyToolState()
  const deps: RegisterDeps = {
    ctx,
    config,
    invoke: (entry, args, options) => ctx.actual.invoke(entry, args, options),
    logger: ctx.logger('actual-tools'),
  }
  const syncer = createSyncer(deps, state)
  const offChange = ctx.actual.onChange(() => {
    void syncer.sync()
  })
  const offPolicy = registerPolicy(ctx, policySettingsOf(config), (publicName) =>
    state.owned.get(publicName),
  )
  const offEnv = registerEnvContext(ctx, ctx.actual)
  ctx.effect(
    () => () => {
      syncer.stop()
      offChange()
      offPolicy()
      offEnv()
      disposeTools(state)
    },
    'actual-tools: lifecycle',
  )

  await syncer.sync()
}
