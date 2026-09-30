/**
 * dsh-plus 子插件：把主插件（@dsh-plus/siyuan）发现的思源能力清单注册为
 * **agent 作用域**的 DSH 工具——只在 `siyuan` 预设内可见，不污染其他预设。
 *
 * 行为：
 * - 惰性等待首次发现（有界、自吞失败），随后监听清单变更整代换新；
 *   发现失败按 5s→60s 指数退避重试，SiYuan 宕机不影响预设激活；
 * - `tools/pre-execute` 写确认接入 DSH 官方审批体系：policy=ask 才弹窗，
 *   never（完全权限/无人值守）直接放行——ask 绝不静默降级为拒绝；
 * - 写前数据历史快照（每会话一次，失败按配置中止，官方 fail-closed 行为）；
 * - system-prompt 动态环境快照（日期 + 连接事实）。
 * @module @dsh-plus/siyuan-tools
 */
import type { Context } from '@deepseek-ai/cordis'

import { Config, type SiyuanToolsConfig } from './config.ts'
import { registerEnvContext } from './env.ts'
import { policySettingsOf, registerPolicy } from './policy.ts'
import { applyManifest, emptyToolState, type RegisterDeps } from './register.ts'
import { createSnapshotGuard } from './snapshot.ts'

export const name = 'dsh-plus-siyuan-tools'

/** 依赖宿主 `siyuan` 服务与 `tools` 注册表；缺席时按「等待服务」挂起。 */
export const inject = ['siyuan', 'tools'] as const

export type { SiyuanToolsConfig }
export { Config }

const RETRY_BASE_MS = 5_000
const RETRY_MAX_MS = 60_000

/** 生命周期闭包状态。 */
interface Lifecycle {
  disposed: boolean
  syncing: Promise<void> | undefined
  retryTimer: ReturnType<typeof setTimeout> | undefined
  retryDelayMs: number
}

/** 提取错误文本。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 装配：先同步挂好监听/策略/快照与清理，再等待首次发现。
 * 首次发现自吞失败（记 warn 并排重试），因此永不使激活失败。
 * @param ctx - 预设作用域上下文。
 * @param config - 已验证的行级配置。
 */
export async function apply(ctx: Context, config: SiyuanToolsConfig): Promise<void> {
  const logger = ctx.logger('siyuan-tools')
  const state = emptyToolState()
  const snapshotGuard = createSnapshotGuard(config, {
    snapshot: (memo, options) => ctx.siyuan.snapshot(memo, options),
    logger,
  })
  const deps: RegisterDeps = {
    ctx,
    config,
    invoke: (entry, args, options) => ctx.siyuan.invoke(entry, args, options),
    beforeWrite: (entry, args) => snapshotGuard.beforeWrite(entry, args),
    logger,
  }
  const life: Lifecycle = {
    disposed: false,
    syncing: undefined,
    retryTimer: undefined,
    retryDelayMs: RETRY_BASE_MS,
  }

  const scheduleRetry = (): void => {
    if (life.disposed || life.retryTimer !== undefined) return
    const delay = life.retryDelayMs
    life.retryDelayMs = Math.min(delay * 2, RETRY_MAX_MS)
    const timer = setTimeout(() => {
      life.retryTimer = undefined
      if (!life.disposed) void sync()
    }, delay)
    timer.unref?.()
    life.retryTimer = timer
  }

  const sync = (): Promise<void> => {
    if (life.syncing !== undefined) return life.syncing
    life.syncing = (async () => {
      try {
        const manifest = await ctx.siyuan.discover()
        if (life.disposed) return
        applyManifest(deps, manifest, state)
        life.retryDelayMs = RETRY_BASE_MS
        logger.info(
          `siyuan tools synced: ${state.disposers.size} tools (source=${manifest.source})`,
        )
      } catch (error) {
        if (life.disposed) return
        logger.warn(`SiYuan capability discovery failed, retry scheduled: ${messageOf(error)}`)
        scheduleRetry()
      } finally {
        life.syncing = undefined
      }
    })()
    return life.syncing
  }

  const offChange = ctx.siyuan.onChange(() => {
    if (!life.disposed) void sync()
  })
  const offPolicy = registerPolicy(ctx, policySettingsOf(config), (publicName) =>
    state.owned.get(publicName),
  )
  const offEnv = registerEnvContext(ctx, ctx.siyuan)
  ctx.effect(
    () => () => {
      life.disposed = true
      offChange()
      offPolicy()
      offEnv()
      if (life.retryTimer !== undefined) clearTimeout(life.retryTimer)
      for (const dispose of state.disposers.values()) dispose()
      state.disposers = new Map()
      state.owned = new Map()
    },
    'siyuan-tools: lifecycle',
  )

  await sync()
}
