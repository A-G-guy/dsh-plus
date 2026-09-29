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
 *
 * 接线约束：inject 声明须覆盖本模块全部 ctx.<service> 直接访问（fallback-llm
 * 读 settings 命名空间与 llm.listProviders），漏掉任一即运行期
 * "cannot get property without inject" → 插件树加载失败 → dsh boot 中止。
 * 可选事实（profileContext）经 ctx.get 读取，缺失即降级而非失败。
 * @module @dsh-plus/lifeboat
 */
import type { Context } from '@deepseek-ai/cordis'
// 平台类型面：profileContext（当前 profile 的 dir/patchPath/name 等运行期事实，
// CLI 与桌面端经同一 profile-boot 提供）。纯类型导入，按开发规范仅需 devDeps。
import type {} from '@deepseek-ai/dsh-app-boot'

import { Config, type FallbackStateT, type LifeboatConfig } from './config.ts'
import { installLlmFallback } from './fallback-llm.ts'
import { registerHealthApi } from './health-api.ts'
import { installAlerter } from './notify.ts'
import { createQuarantine, installHostWatch } from './quarantine.ts'
import { registerQuarantineApi } from './quarantine-api.ts'
import { appendJournal, loadState, type StateDoc, saveState } from './state-file.ts'

export const name = 'dsh-plus-lifeboat'

export const inject = ['settings', 'llm'] as const

export { Config }

/**
 * 隔离目标 patch 文件解析：显式配置优先；缺省取当前 profile 的用户 patch 层
 * （`profileContext.patchPath`——CLI 的 web profile 与桌面端的 desktop profile
 * 同源）。两者皆无（非 dsh 启动的裸 cordis 树）返回 undefined：隔离停用，
 * 绝不回退到硬编码 profile 路径——那会把 disabled 覆盖写进别的 profile。
 */
/** 解析隔离目标 patch 文件（导出供单测；语义见注释）。 */
export function resolvePatchFile(ctx: Context, config: LifeboatConfig): string | undefined {
  if (config.patchFile.length > 0) return config.patchFile
  return ctx.get('profileContext')?.patchPath
}

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
    const patchFile = resolvePatchFile(ctx, config)
    if (patchFile === undefined) {
      // 无 profileContext 的组合树（非 dsh 启动）：不猜路径、不写任何 patch，
      // 隔离停用但告警/journal/LLM 应急翻译照常（它们不依赖 patch 文件）。
      warn('故障隔离停用：当前组合树无 profileContext，无法定位 profile 用户 patch 层')
    } else {
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
