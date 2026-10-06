/**
 * dsh 插件：故障救生艇。
 * 职责（全部事件触发，平时零开销）：
 * 1. 故障隔离——兄弟 dsh-plus 插件 fiber FAILED 时（host 侧直接监听，浏览器侧
 *    经哨兵回报），向 profile 用户 patch 层写入 disabled 覆盖；重启/刷新后
 *    失败插件缺席、其余正常，修复后删覆盖即恢复。
 * 2. LLM 应急指引——默认模型 provider 无 adapter 时，读取 @dsh-plus/llm-pi
 *    常备的官方应急副本（$DSH_HOME/llm-pi.official-patch.yaml）并告警指引
 *    应用方式；只告警不写（旧「自动改写配置」不稳定、常无效，已移除）。
 * 3. 告警与 journal——一切动作记录进运行期状态文件（state-file.ts），并经
 *    notify-email 发邮件（缺席降级为日志）。
 *
 * 零 dsh-plus 内部依赖铁律：不 import 本仓库任何其他包，防止共享代码故障团灭。
 * 应急副本经文件契约同路径消费（见 official-copy-status.ts）。
 *
 * 接线约束：inject 声明须覆盖本模块全部 ctx.<service> 直接访问——settings
 * （copy-guide 读默认模型条目）与 llm（判定 provider 缺席），漏掉任一即运行期
 * "cannot get property without inject" → 插件树加载失败 → dsh boot 中止。
 * 可选事实（profileContext）经 ctx.get 读取，缺失即降级而非失败。
 * @module @dsh-plus/lifeboat
 */
import type { Context } from '@deepseek-ai/cordis'
// 平台类型面：profileContext（当前 profile 的 dir/patchPath/name 等运行期事实，
// CLI 与桌面端经同一 profile-boot 提供）。纯类型导入，按开发规范仅需 devDeps。
import type {} from '@deepseek-ai/dsh-app-boot'

import { Config, type LifeboatConfig } from './config.ts'
import { installCopyGuide } from './copy-guide.ts'
import { registerHealthApi } from './health-api.ts'
import { installAlerter } from './notify.ts'
import { readOfficialCopyStatus } from './official-copy-status.ts'
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

  // 运行期状态（journal）：文件持久化。加载失败降级为内存态
  // （重启丢失 journal，但隔离/告警功能仍在）。
  const warn = (message: string): void => logger.warn(message)
  let doc: StateDoc = { journal: [] }
  void loadState().then((loaded) => {
    doc = loaded
  })

  const journal = (kind: string, detail: string): void => {
    doc = appendJournal(doc, kind, detail)
    void saveState(doc, warn)
  }

  const alert = installAlerter(ctx, journal)

  // LLM 应急副本指引：只读判定 + 告警，不依赖 patch 文件，独立于隔离开关。
  installCopyGuide(ctx, {
    journal,
    alert,
    profile: ctx.get('profileContext')?.name,
    cooldownMs: config.alertCooldownMs,
  })

  if (config.enabled) {
    const patchFile = resolvePatchFile(ctx, config)
    if (patchFile === undefined) {
      // 无 profileContext 的组合树（非 dsh 启动）：不猜路径、不写任何 patch，
      // 隔离停用但告警/journal 照常。
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
          readCopy: () => readOfficialCopyStatus(),
        })
      })
    }
  }
}
