/**
 * 配置卡片文案（zh/en）。经 ctx.locale.register 注册、bind 取用，与官方卡片同机制。
 * 公共键（save/discard/unsaved 等）来自 shared 的 common 字典，本文件只维护业务键。
 * @module access-gate/client/i18n
 */
import { commonEn, commonZh, mergeDict } from '@dsh-plus/shared/client'

export const NS = 'dsh-plus-access-gate'

const ownZh = {
  title: '访问控制',
  description: 'Web 访问围栏：本机直连放行；远程按白名单 IP 或访问令牌放行，其余拦截到登录页。',
  enabled: '启用访问围栏',
  enabledHint: '关闭即完全旁路（等价插件缺席）；启用后远程流量需命中白名单或令牌。',
  token: '访问令牌',
  tokenHint: '留空表示保持已存令牌不变；清空并保存需先输入既有令牌确认。',
  tokenSet: '已配置',
  tokenUnset: '未配置',
  allowedIps: '放行 IP 白名单',
  allowedIpsHint:
    '每行一个：精确 IP 或 CIDR（IPv4/IPv6 皆可），如 100.86.108.55 或 fd7a:115c:a1e0::/48。',
  trustForwardedFor: '信任 x-forwarded-for 还原客户端 IP',
  trustForwardedForHint:
    '仅当入口代理强制覆盖该头时开启（tailscale serve 满足）；直连暴露场景必须关闭。',
  cookieMaxAgeHours: '登录有效期（小时）',
  cookieMaxAgeHoursHint: '令牌登录后 cookie 的有效期。',
  loginFailLimit: '登录失败阈值',
  loginFailLimitHint: '每个 IP 在冷却窗口内允许的失败次数，超出进入冷却。',
  loginCooldownMs: '登录冷却（毫秒）',
  loginCooldownMsHint: '失败达到阈值后的冷却时长。',
  diagTitle: '当前页面诊断',
  diagVerdict: '本页判定',
  diagClientIp: '客户端 IP',
  diagReason: '放行原因',
  diagLocal: '本机直连',
  diagAllowedIp: '白名单 IP',
  diagToken: '令牌',
  diagPass: '放行',
  diagBlock: '拦截',
  diagLogin: '登录页',
  diagOff: '围栏未启用',
  diagInvalid: '白名单存在无法解析的条目：',
  warnFailClosed: '警告：已启用但令牌与白名单均为空——所有远程访问将被拒绝（含本页之外的设备）。',
}

const ownEn = {
  title: 'Access Control',
  description:
    'Web access gate: loopback passes; remote traffic needs an allowlisted IP or the token, others hit the login page.',
  enabled: 'Enable access gate',
  enabledHint:
    'Off means full bypass (as if absent); on, remote traffic must match the allowlist or the token.',
  token: 'Access token',
  tokenHint: 'Leave blank to keep the stored token; clearing requires typing the current one.',
  tokenSet: 'Set',
  tokenUnset: 'Not set',
  allowedIps: 'Allowed IP allowlist',
  allowedIpsHint:
    'One per line: exact IP or CIDR (IPv4/IPv6), e.g. 100.86.108.55 or fd7a:115c:a1e0::/48.',
  trustForwardedFor: 'Trust x-forwarded-for for client IP',
  trustForwardedForHint:
    'Enable only when the entry proxy overwrites that header (tailscale serve does); must be off for direct exposure.',
  cookieMaxAgeHours: 'Login validity (hours)',
  cookieMaxAgeHoursHint: 'Cookie lifetime after a token login.',
  loginFailLimit: 'Login failure limit',
  loginFailLimitHint: 'Failures per IP within the cooldown window before throttling.',
  loginCooldownMs: 'Login cooldown (ms)',
  loginCooldownMsHint: 'Cooldown duration after reaching the limit.',
  diagTitle: 'This page',
  diagVerdict: 'Verdict',
  diagClientIp: 'Client IP',
  diagReason: 'Reason',
  diagLocal: 'loopback',
  diagAllowedIp: 'allowlisted IP',
  diagToken: 'token',
  diagPass: 'pass',
  diagBlock: 'blocked',
  diagLogin: 'login page',
  diagOff: 'gate disabled',
  diagInvalid: 'Allowlist entries that failed to parse:',
  warnFailClosed:
    'Warning: enabled with no token and an empty allowlist — all remote access will be refused.',
}

export const zh: Record<string, string> = mergeDict(commonZh, ownZh)
export const en: Record<string, string> = mergeDict(commonEn, ownEn)
