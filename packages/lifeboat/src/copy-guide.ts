/**
 * LLM 应急副本指引：默认模型的 provider 无已注册 adapter 时（典型场景：llm-pi
 * 被隔离/加载失败），读取 @dsh-plus/llm-pi 常备的官方应急副本并告警指引应用
 * 方式（--patch 单次启动，或并入 profile 的 cordis.patch.yml 热应用）。
 *
 * 只告警不写：配置面的唯一写者是 llm-pi 与用户，救生艇不碰配置文件——
 * 旧「出错时自动改写配置」因不稳定、常无效已移除，指引把操作交还给人。
 *
 * 评估时机：启动宽限（兄弟插件就绪竞态）结束后一次 + 默认模型配置变化 /
 * adapter 集变化事件；平时零开销。同一指引受 alertCooldownMs 冷却（内存态，
 * 重启复位——告警是提示不是状态）。
 * @module lifeboat/copy-guide
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'

import type { Alerter } from './notify.ts'
import { type OfficialCopyStatus, readOfficialCopyStatus } from './official-copy-status.ts'

/** 默认模型的 settings 命名空间（dsh 官方 agent 区）。 */
const NS_AGENT_DEFAULT = 'agent-default-model'

/** 启动宽限（ms）：llm-pi 等兄弟插件的 adapter 注册晚于 lifeboat 就绪，宽限内
 *  不评估，避免把「还没加载」误判为「缺席」而每次重启都误发告警。 */
export const BOOT_GRACE_MS = 60_000

export interface CopyGuideDeps {
  journal: (kind: string, detail: string) => void
  alert: Alerter
  /** 副本状态读取（缺省读契约路径；测试注入固定值）。 */
  readCopy?: () => Promise<OfficialCopyStatus>
  /** 来源 profile（告警里的应用命令；非 dsh 启动时缺省占位）。 */
  profile: string | undefined
  /** 同一指引告警的最小间隔毫秒数。 */
  cooldownMs: number
}

/** 默认模型的 provider（settings describe 平面视图；未配置返回 undefined）。 */
function defaultProvider(ctx: Context): string | undefined {
  const value = ctx.settings.describe().find((row) => row.ns === NS_AGENT_DEFAULT)?.value
  return (value as { provider?: unknown } | undefined)?.provider as string | undefined
}

/** 生成时间文案（副本不含时间戳，mtime 即生成时间）。 */
function generatedText(copy: OfficialCopyStatus): string {
  if (copy.updatedAt === undefined) return '生成时间未知'
  return new Date(copy.updatedAt).toISOString().slice(0, 19).replace('T', ' ')
}

/** 副本指引结果（journal 措辞用）。 */
type GuideOutcome = 'ready' | 'missing' | 'empty'

/** 副本缺失：应用无从谈起，先恢复 llm-pi 侧的生成能力。 */
function alertMissing(copy: OfficialCopyStatus, provider: string, deps: CopyGuideDeps): void {
  deps.alert(
    '[DSH] LLM 应急副本缺失',
    `默认模型的 provider "${provider}" 没有已注册 adapter，且官方应急副本 ${copy.path} 不存在（dsh-plus-llm-pi 未生成或已被删除）。先恢复 dsh-plus-llm-pi 让它生成副本，或手动修复 LLM 配置。`,
  )
}

/** 副本存在但为空：应用无效果，先修 llm-pi 配置并等待重新生成。 */
function alertEmpty(copy: OfficialCopyStatus, provider: string, deps: CopyGuideDeps): void {
  deps.alert(
    '[DSH] LLM 应急副本为空',
    `默认模型的 provider "${provider}" 没有已注册 adapter；应急副本 ${copy.path} 存在但无任何 route（llm-pi 未配置或全部不可服务），应用无效果。先修复 dsh-plus-llm-pi 配置并等待副本重新生成。`,
  )
}

/** 就绪副本的应用指引告警。 */
function alertReady(copy: OfficialCopyStatus, provider: string, deps: CopyGuideDeps): void {
  const profile = deps.profile ?? '<profile>'
  const warnings = copy.warnings.length > 0 ? ` 生成警告：${copy.warnings.join('；')}` : ''
  deps.alert(
    '[DSH] LLM 应急副本可应用',
    `默认模型的 provider "${provider}" 没有已注册 adapter（llm-pi 缺席/故障？）。官方应急副本已就绪：${copy.path}（${generatedText(copy)}，${copy.routes ?? 0} 个 route）。` +
      `应用（重启/重载生效）：dsh ${profile} --patch ${copy.path}；或把副本条目并入该 profile 的 cordis.patch.yml（web 热应用）。` +
      `应用即切换：副本禁用 dsh-plus-llm-pi 并替换 llm-pi-ai 配置；回退只需移除 --patch 参数或并入的条目。${warnings}`,
  )
}

/** 分派指引：按副本形态发出对应告警并返回结果。 */
function guide(copy: OfficialCopyStatus, provider: string, deps: CopyGuideDeps): GuideOutcome {
  if (!copy.exists) {
    alertMissing(copy, provider, deps)
    return 'missing'
  }
  if ((copy.routes ?? 0) === 0) {
    alertEmpty(copy, provider, deps)
    return 'empty'
  }
  alertReady(copy, provider, deps)
  return 'ready'
}

/** journal 措辞。 */
function outcomeText(outcome: GuideOutcome, routes: number): string {
  if (outcome === 'ready') return `可应用（${routes} 个 route）`
  if (outcome === 'missing') return '缺失'
  return '为空'
}

/** 装配副本指引：宽限结束后及事件触发评估（并发合并、告警带冷却）。 */
export function installCopyGuide(
  ctx: Context,
  deps: CopyGuideDeps,
  graceMs: number = BOOT_GRACE_MS,
): void {
  const logger = ctx.logger('lifeboat')
  const readCopy = deps.readCopy ?? (() => readOfficialCopyStatus())
  let inFlight: Promise<void> | undefined
  // -Infinity 而非 0：首个事件必须能越过冷却闸（mock 时钟下 Date.now() 从 0 起算）。
  let lastAlertAt = Number.NEGATIVE_INFINITY
  const startedAt = Date.now()

  async function evaluate(): Promise<void> {
    const provider = defaultProvider(ctx)
    if (provider === undefined) return // 未配置默认模型：无从判定缺席
    if (ctx.llm.listProviders().some((item) => item.id === provider)) return // LLM 正常
    if (Date.now() - lastAlertAt < deps.cooldownMs) return
    const copy = await readCopy()
    lastAlertAt = Date.now()
    const outcome = guide(copy, provider, deps)
    deps.journal(
      'llm-copy-guide',
      `默认模型 provider "${provider}" 缺席；副本${outcomeText(outcome, copy.routes ?? 0)}`,
    )
  }

  const run = (): void => {
    if (Date.now() - startedAt < graceMs) return
    if (inFlight !== undefined) return
    inFlight = evaluate()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`副本指引评估失败: ${message}`)
        deps.journal('llm-copy-guide-error', message)
      })
      .finally(() => {
        inFlight = undefined
      })
  }

  const bootTimer = setTimeout(run, graceMs)
  ctx.effect(() => () => clearTimeout(bootTimer), 'lifeboat: copy guide boot timer')
  // 只响应默认模型配置变化：journal 写自身数据，不过滤会自触发循环。
  ctx.root.on('settings/document-updated', (ns: unknown) => {
    if (ns === NS_AGENT_DEFAULT) run()
  })
  // 事件名已核对：dsh-llm 在每次 adapter 注册/注销提交点派发（module augmentation
  // 声明随 @deepseek-ai/dsh-llm 类型导入携带，无需 as never）。
  ctx.root.on('llm/adapters-updated', () => run())
}
