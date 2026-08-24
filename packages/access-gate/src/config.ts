/**
 * 配置单一事实源：cordis 行级 Config（组合默认值，dev/prod patch 层可覆盖）
 * 与 settings namespace（用户层，经 dsh-settings-file 持久化到 $DSH_HOME/settings.yaml）
 * 共用同一 schemastery schema（notify-email 同款约定）。
 * token 标记 secret 角色：任何读取通道不得回传明文。
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
  token: z
    .string()
    .role('secret')
    .description('访问令牌；空字符串 = token 通道关闭。经登录页输入后以 HttpOnly cookie 持有')
    .default(''),
  allowedIps: z
    .array(z.string())
    .description('放行 IP 白名单：精确 IP 或 CIDR（IPv4/IPv6 皆可）')
    .default([]),
  trustForwardedFor: z
    .boolean()
    .description(
      '是否信任 x-forwarded-for 还原真实客户端 IP（仅当入口代理强制覆盖该头时开启；tailscale serve 满足）',
    )
    .default(true),
  cookieMaxAgeHours: z
    .natural()
    .max(24 * 365)
    .description('登录 cookie 有效期（小时）')
    .default(720),
  loginFailLimit: z
    .natural()
    .description('登录失败节流阈值（每 IP 冷却窗口内允许的失败次数）')
    .default(10),
  loginCooldownMs: z.natural().description('登录失败节流冷却毫秒数').default(60000),
})

export type AccessGateConfig = Schemastery.TypeT<typeof Config>

/** 判定所需的最小配置视图（测试与决策函数共用窄面）。 */
export interface GatePolicy {
  readonly enabled: boolean
  readonly token: string
  readonly allowedIps: readonly string[]
  readonly trustForwardedFor: boolean
}

/** 远程放行通道是否全部关闭（enabled 且无 token 且白名单空 = 拒绝一切远程）。 */
export function isFailClosed(policy: GatePolicy): boolean {
  return policy.enabled && policy.token === '' && policy.allowedIps.length === 0
}
