/**
 * 配置单一事实源：cordis 行级 Config（组合默认值，dev/prod patch 层可覆盖）
 * 与 settings namespace（用户层，经 dsh-settings-file 持久化到 $DSH_HOME/settings.yaml）
 * 共用同一 schemastery schema（notify-email 同款约定）。
 *
 * 与官方认证合并后：访问凭据唯一化为官方 browser-auth cookie（dsh-auth-*，
 * 由 client-connection 的 ?token= 启动令牌交换签发），本插件不再持有自有
 * token/cookie；allowedIps 降级为可选的附加 IP 围栏。
 * 旧配置中的 token/cookieMaxAgeHours/loginFailLimit/loginCooldownMs 键由
 * schemastery 透传忽略，不阻断加载（已实测验证）。
 * @module access-gate/config
 */
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

import { SETTINGS_NS as NS_LITERAL } from './ns.ts'

/** settings 命名空间；webui 配置卡片与插件运行期读取同一份（字面量见 ./ns.ts）。 */
export const SETTINGS_NS = settingsNamespace(NS_LITERAL)

export const Config = z.object({
  enabled: z
    .boolean()
    .description('访问围栏总开关（false = 一切放行，等价插件缺席）')
    .default(false),
  allowedIps: z
    .array(z.string())
    .description(
      '附加 IP 围栏：非空时仅白名单条目（精确 IP 或 CIDR，IPv4/IPv6 皆可）可通行与登录；空 = 不限制来源 IP（仅官方登录保护）',
    )
    .default([]),
  trustForwardedFor: z
    .boolean()
    .description(
      '是否信任 x-forwarded-for 还原真实客户端 IP（仅当入口代理强制覆盖该头时开启；tailscale serve 满足）',
    )
    .default(true),
})

export type AccessGateConfig = Schemastery.TypeT<typeof Config>

/** 判定所需的最小配置视图（测试与决策函数共用窄面）。 */
export interface GatePolicy {
  readonly enabled: boolean
  readonly allowedIps: readonly string[]
  readonly trustForwardedFor: boolean
}
