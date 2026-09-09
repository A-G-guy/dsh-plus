/**
 * dsh 插件：故障救生艇。
 * 职责（全部事件触发，平时零开销）：
 * 1. 故障隔离——兄弟 dsh-plus 插件 fiber FAILED 时（host 侧直接监听，浏览器侧
 *    经哨兵回报），向 profile 用户 patch 层写入 disabled 覆盖；重启/刷新后
 *    失败插件缺席、其余正常，修复后删覆盖即恢复。
 * 2. LLM 应急翻译——默认模型 provider 无 adapter 时，把 dsh-plus-llm-pi 配置
 *    临时翻译为官方 llm-pi-ai 路由并切换默认模型，恢复后自动还原。
 * 3. 告警与 journal——一切动作记录进运行期状态文件（state-file.ts），并经
 *    notify-email 发邮件（缺席降级为日志）。
 *
 * 零 dsh-plus 内部依赖铁律：不 import 本仓库任何其他包，防止共享代码故障团灭。
 * @module @dsh-plus/lifeboat
 */
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

import { Config, type FallbackStateT, type LifeboatConfig } from './config.ts'
import { installLlmFallback } from './fallback-llm.ts'
import { registerHealthApi } from './health-api.ts'
import { installAlerter } from './notify.ts'
import { createQuarantine, installHostWatch } from './quarantine.ts'
import { registerQuarantineApi } from './quarantine-api.ts'
import { appendJournal, loadState, type StateDoc, saveState } from './state-file.ts'

export const name = 'dsh-plus-lifeboat'

export const inject = ['llm'] as const

export { Config }

export function apply(ctx: Context, config: LifeboatConfig): void {
  const logger = ctx.logger('lifeboat')

  // 运行期状态（journal + 翻译状态）：文件持久化。加载失败降级为内存态
  // （重启丢失 journal，但隔离/翻译功能仍在）。
  const warn = (message: string): void => logger.warn(message)
  let doc: StateDoc = { journal: [], llmFallback: null }
  void loadState().then((loaded) => {
    doc = loaded
  })

  const journal = (kind: string, detail: string): void => {
    doc = appendJournal(doc, kind, detail)
    void saveState(doc, warn)
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
        await saveState(doc, warn)
      },
    })
  }
}
