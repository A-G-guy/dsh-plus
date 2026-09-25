/**
 * 插件配置（schemastery）：可调参数一律外部化，不在逻辑里硬编码。
 *
 * 与仓库既有约定一致：Config 由 cordis 行级 config 解析，部署方可在
 * profile 的 cordis.patch.yml 覆盖；同时经 settings namespace 暴露到
 * $DSH_HOME/settings.yaml 用户层，修改热生效（无需 /reload）。
 * @module @dsh-plus/web-shell-sw/config
 */
import z from '@deepseek-ai/schemastery'
import type { UnwrapVolatile } from '@dsh-plus/shared'

// 0.1.7：`.volatile()` 使条目进入 settings describe 视图（卡片可读写）并让
// loader 以活动引用原位提交热更新。
export const Config = z.object({
  enabled: z
    .boolean()
    .description(
      '总开关（false = 浏览器半注销已注册的 Service Worker 并清空本插件缓存，恢复原生网络行为）',
    )
    .default(true)
    .volatile(),
})

/** 活动字段形态（0.1.7 loader 解析产物：volatile 字段为活动引用）。 */
export type WebShellSwConfigFields = Schemastery.TypeT<typeof Config>
/** 平面配置形态（消费面的读取形态，由活动引用解包得到）。 */
export type WebShellSwConfig = UnwrapVolatile<WebShellSwConfigFields>
