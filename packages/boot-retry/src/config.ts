/**
 * 插件配置（schemastery）：可调参数一律外部化，不在逻辑里硬编码。
 *
 * 与仓库既有约定一致：Config 由 cordis 行级 config 解析，部署方可在
 * profile 的 cordis.patch.yml 覆盖单个字段（注意 patch 层是整体替换，
 * 需写全字段）。
 * @module @dsh-plus/boot-retry/config
 */
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  enabled: z.boolean().description('总开关（false = 注入脚本缺席，等价插件未安装）').default(true),
  maxAttempts: z
    .number()
    .step(1)
    .min(1)
    .max(10)
    .description('单个插件包的加载尝试总次数（含首次）；1 = 不重试')
    .default(3),
  backoffMs: z
    .array(z.number().step(1).min(0))
    .description('两次尝试之间的退避毫秒数，按序取用，用尽后重复最后一项')
    .default([250, 750]),
  retryShellScript: z
    .boolean()
    .description('是否同时兜底外壳 module 脚本（/assets/index-*.js）加载失败')
    .default(true),
  shellMaxAttempts: z
    .number()
    .step(1)
    .min(1)
    .max(10)
    .description('外壳脚本的最大重试次数（不含首次）')
    .default(2),
})

export type BootRetryConfig = Schemastery.TypeT<typeof Config>
