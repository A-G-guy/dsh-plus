/**
 * dsh 插件：手动触发技能（manual skills）独立目录。
 *
 * 扫描 `$DSH_HOME/skills-manual`（默认，可用 root 配置覆盖），识别与撰写规范完全
 * 复用上游 `@deepseek-ai/dsh-skill-filesystem`；区别在于本 provider 把发现的每个
 * skill 强制映射为 `modelInvocable: false`——不进入模型 skills catalog、不可被
 * `skill` 工具主动加载，但仍出现在用户侧斜杠发现中，由用户发送 `/name` 时经上游
 * user-explicit gesture 边界把 `<skill_content>` 注入会话（或用户直接粘贴路径）。
 *
 * 契约权威来源：docs/plugin-dev/skill-manual-手动技能.md
 * @module @dsh-plus/skill-manual
 */
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import z from '@deepseek-ai/schemastery'

import { createManualProvider } from './manual-provider.ts'

export const name = 'dsh-plus-skill-manual'

export const inject = ['skills'] as const

export const Config = z.object({
  /** provider 在 ctx.skills 注册表中的唯一名（默认层内无冲突即可）。 */
  providerName: z.string().default('skill-manual'),
  /** 手动技能根目录；默认 `$DSH_HOME/skills-manual`（跟随 dev/prod home 隔离）。 */
  root: z.string().default(dshHomePath('skills-manual')),
  /** 是否监听根目录变化并失效目录缓存（上游 Chokidar  watcher 语义）。 */
  watch: z.boolean().default(true),
  /** Chokidar 使用轮询而非原生事件。 */
  watchUsePolling: z.boolean().default(false),
})

export type SkillManualConfig = Schemastery.TypeT<typeof Config>

export function apply(ctx: Context, config?: SkillManualConfig): void {
  const cfg = Config(config ?? {})
  let inner: FileSystemSkillProvider | undefined
  ctx.skills.registerProvider((control) => {
    inner = new FileSystemSkillProvider(ctx, control, {
      providerName: cfg.providerName,
      includeDefaultRoots: false,
      customSkillDirs: [cfg.root],
      watch: cfg.watch,
      watchUsePolling: cfg.watchUsePolling,
    })
    return createManualProvider(inner)
  })
  ctx.effect(() => {
    return async () => {
      await inner?.dispose()
    }
  })
  // 第一方 fs 写/编辑工具的快路径失效：observeHostMutation 内部按 watched root
  // 自过滤（isPotentialSkillPath），无关路径最多造成一次无害的缓存失效。
  ctx.on('fs/observed', (target: FsTarget) => {
    inner?.observeHostMutation(target.displayPath)
  })
}
