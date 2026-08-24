/**
 * dsh 插件：故障救生艇。
 * 职责（全部事件触发，平时零开销）：
 * 1. 故障隔离——兄弟 dsh-plus 插件 fiber FAILED 时（host 侧直接监听，浏览器侧
 *    经哨兵回报），向 profile 用户 patch 层写入 disabled 覆盖；重启/刷新后
 *    失败插件缺席、其余正常，修复后删覆盖即恢复。
 * 2. LLM 应急翻译——默认模型 provider 无 adapter 时，把 dsh-plus-llm-pi 配置
 *    临时翻译为官方 llm-pi-ai 路由并切换默认模型，恢复后自动还原。
 * 3. 告警与 journal——一切动作记录进自身 settings 命名空间，并经 notify-email
 *    发邮件（缺席降级为日志）。
 *
 * 零 dsh-plus 内部依赖铁律：不 import 本仓库任何其他包，防止共享代码故障团灭。
 * @module @dsh-plus/lifeboat
 */
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

import {
  Config,
  type FallbackStateT,
  type JournalDoc,
  JournalSchema,
  type LifeboatConfig,
  SETTINGS_NS,
} from './config.ts'
import { installLlmFallback } from './fallback-llm.ts'
import { registerHealthApi } from './health-api.ts'
import { installAlerter } from './notify.ts'
import { createQuarantine, installHostWatch } from './quarantine.ts'
import { registerQuarantineApi } from './quarantine-api.ts'

export const name = 'dsh-plus-lifeboat'

export const inject = ['settings', 'llm'] as const

export { Config }

/** journal 上限：只留最近 50 条，防长期运行膨胀。 */
const JOURNAL_CAP = 50

export function apply(ctx: Context, config: LifeboatConfig): void {
  const logger = ctx.logger('lifeboat')

  // 自身命名空间：journal 与翻译状态的持久化。schema 宽松，注册失败也不能
  // 拖垮救生艇——降级为内存态（重启丢失 journal，但隔离/翻译功能仍在）。
  let doc: JournalDoc = { journal: [], llmFallback: null }
  let persist: ((patch: object) => Promise<void>) | undefined
  try {
    const scope = ctx.settings.register(SETTINGS_NS, JournalSchema)
    doc = scope.get()
    persist = (patch) => scope.update(patch)
  } catch (error) {
    logger.warn(
      `journal 命名空间注册失败，降级为内存态: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const journal = (kind: string, detail: string): void => {
    doc = {
      ...doc,
      journal: [...doc.journal, { at: new Date().toISOString(), kind, detail }].slice(-JOURNAL_CAP),
    }
    void persist?.({ journal: doc.journal }).catch((error: unknown) => {
      logger.warn(`journal 持久化失败: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  const alert = installAlerter(ctx, journal)

  if (config.enabled) {
    const patchFile =
      config.patchFile.length > 0
        ? config.patchFile
        : dshHomePath('profiles', 'web', 'cordis.patch.yml')
    const quarantine = createQuarantine(ctx, {
      patchFile,
      alertCooldownMs: config.alertCooldownMs,
      journal,
      alert,
    })
    installHostWatch(ctx, quarantine)
    ctx.inject(['webServer'], (webCtx) => {
      registerQuarantineApi(webCtx, quarantine)
      registerHealthApi(webCtx, {
        patchFile,
        journal,
        alert,
        readJournal: () => doc.journal,
        readFallback: () => doc.llmFallback,
      })
    })
  }

  if (config.llmFallback) {
    installLlmFallback(ctx, {
      journal,
      alert,
      readState: () => doc.llmFallback,
      writeState: async (state: FallbackStateT | null) => {
        doc = { ...doc, llmFallback: state }
        await persist?.({ llmFallback: state })
      },
    })
  }
}
