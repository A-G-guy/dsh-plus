/**
 * 配置单一事实源。
 * - 行级 Config（cordis 组合层）：救生艇自身行为开关，dev/prod patch 层可覆盖。
 * - journal 与 LLM 应急翻译状态属运行期数据，按存储规范持久化到
 *   $DSH_HOME/dsh-plus/lifeboat/state.json（见 state-file.ts），不进 settings。
 * @module lifeboat/config
 */

import z from '@deepseek-ai/schemastery'

/** 行级配置：全部有默认值，正常部署零配置。 */
export const Config = z.object({
  enabled: z.boolean().description('故障隔离总开关').default(true),
  patchFile: z
    .string()
    .description(
      '隔离写入的 profile 用户 patch 文件绝对路径；留空自动取 $DSH_HOME/profiles/web/cordis.patch.yml',
    )
    .default(''),
  llmFallback: z
    .boolean()
    .description('llm-pi 缺席时自动翻译其配置到官方 llm-pi-ai 并切换默认模型')
    .default(true),
  alertCooldownMs: z.natural().description('同一插件重复告警的最小间隔毫秒数').default(300000),
})

export type LifeboatConfig = Schemastery.TypeT<typeof Config>

/** journal 单条记录（纯类型，磁盘收窄见 state-file.ts）。 */
export interface JournalEntryT {
  at: string
  kind: string
  detail: string
}

/** LLM 应急翻译的持久状态（还原依据；纯类型，磁盘收窄见 state-file.ts）。 */
export interface FallbackStateT {
  active: boolean
  originalProvider: string
  originalModel: string
  fallbackProvider: string
  providers: string[]
  at: string
}
