/**
 * 配置与 journal 单一事实源。
 * - 行级 Config（cordis 组合层）：救生艇自身行为开关，dev/prod patch 层可覆盖。
 * - settings 命名空间 dsh-plus-lifeboat：运行期 journal 与 LLM 应急翻译状态，
 *   经 dsh-settings-file 持久化到 $DSH_HOME/settings.yaml，重启后可据此还原。
 * schema 刻意宽松：lifeboat 是最后防线，自身命名空间的数据问题绝不能让它起不来。
 * @module lifeboat/config
 */

import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

import { SETTINGS_NS as NS_LITERAL } from './ns.ts'

/** settings 命名空间（品牌化后供 settings 服务注册/读写）。 */
export const SETTINGS_NS = settingsNamespace(NS_LITERAL)

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

/** journal 单条记录。 */
const JournalEntry = z.object({
  at: z.string(),
  kind: z.string(),
  detail: z.string(),
})

/** LLM 应急翻译的持久状态（还原依据）。 */
const FallbackState = z.object({
  active: z.boolean(),
  originalProvider: z.string(),
  originalModel: z.string(),
  fallbackProvider: z.string(),
  providers: z.array(z.string()),
  at: z.string(),
})

/** 命名空间 schema：宽松承载 journal 与翻译状态，上限截断防膨胀。 */
export const JournalSchema = z.object({
  journal: z.array(JournalEntry).description('救生艇操作日志（最新在尾，封顶 50 条）').default([]),
  llmFallback: z
    .union([FallbackState, z.const(null)])
    .description('LLM 应急翻译状态；null 表示未处于降级')
    .default(null),
})

export type JournalDoc = Schemastery.TypeT<typeof JournalSchema>
export type FallbackStateT = Schemastery.TypeT<typeof FallbackState>
