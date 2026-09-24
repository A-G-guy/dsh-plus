/**
 * 插件配置（schemastery）：匹配模式与重试次数一律外部化。
 *
 * 与仓库既有约定一致：Config 由 cordis 行级 config 解析，部署方在 profile 的
 * cordis.patch.yml 按 id 覆盖单个字段（patch 层整体替换，需写全字段）。
 * @module @dsh-plus/error-retry/config
 */
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  enabled: z.boolean().description('总开关（false = 不注册监听，等价插件未安装）').default(true),
  maxRetries: z
    .number()
    .step(1)
    .min(1)
    .max(50)
    .description('匹配报错的重试次数上限（每次重试都是一次新的计费请求）')
    .default(5),
  patterns: z
    .array(z.string().min(1))
    .description(
      '纳入重试的报错匹配模式，命中 failure.message 即改写重试策略；' +
        '普通字符串为模糊子串（大小写不敏感，空格/连字符/下划线等价），' +
        '/.../ 形式按正则解释（未带 i 时自动补 i）；空数组 = 不匹配任何报错',
    )
    .default(['content-filter']),
})

export type ErrorRetryConfig = Schemastery.TypeT<typeof Config>
