/**
 * 配置卡片文案（zh/en）。经 ctx.locale.register 注册、bind 取用，与官方卡片同机制。
 * 公共键（save/discard/unsaved 等）来自 shared 的 common 字典，本文件只维护业务键。
 * @module access-gate/client/i18n
 */
import { commonEn, commonZh, mergeDict } from '@dsh-plus/shared/client'

export const NS = 'dsh-plus-access-gate'

const ownZh = {
  title: '访问控制',
  description:
    'Web 访问围栏：与官方登录合并——官方 cookie 为唯一凭据；未认证导航显示启动令牌输入页（PWA 内可用）；可选 IP 附加围栏。',
  enabled: '启用访问围栏',
  enabledHint: '关闭即完全旁路（等价插件缺席）；启用后未认证流量被拦截到令牌输入页或拒绝。',
  mergedHint:
    '登录凭据由官方认证持有（启动令牌换 30 天 cookie）。获取当前令牌：服务器执行 dshctl url，或本机访问 /dsh-plus/gate/launch-url。',
  allowedIps: '附加 IP 围栏白名单',
  allowedIpsHint:
    '每行一个：精确 IP 或 CIDR（IPv4/IPv6 皆可）。非空时仅白名单来源可通行与登录；留空 = 不限制来源 IP（仅官方登录保护）。',
  autoLoginHint:
    'IP 信任自动登录：白名单来源未认证时自动签发官方登录 cookie，免输启动令牌。开启即视为信任白名单内全部设备（tailnet 内），请确保白名单准确。',
  trustForwardedFor: '信任 x-forwarded-for 还原客户端 IP',
  trustForwardedForHint:
    '仅当入口代理强制覆盖该头时开启（tailscale serve 满足）；直连暴露场景必须关闭。',
  diagTitle: '当前页面诊断',
  diagVerdict: '本页判定',
  diagClientIp: '客户端 IP',
  diagReason: '放行原因',
  diagLocal: '本机直连',
  diagCookie: '官方 cookie',
  diagTrustedIp: 'IP 信任白名单',
  diagOfficial: '官方登录状态',
  diagOfficialYes: '已登录',
  diagOfficialNo: '未登录',
  diagPass: '放行',
  diagBlock: '拦截',
  diagTokenPage: '令牌输入页',
  diagAutoLogin: '自动登录',
  diagAutoLoginVerdict: '自动登录（免 token 进入）',
  diagAutoLoginReady: '已就绪（签名密钥可读）',
  diagAutoLoginNoSecret: '不可用（签名密钥读取失败，已降级）',
  diagOff: '围栏未启用',
  diagInvalid: '白名单存在无法解析的条目：',
}

const ownEn = {
  title: 'Access Control',
  description:
    'Web access gate merged with official auth: the official cookie is the sole credential; unauthenticated navigations get a launch-token page (works inside the PWA); optional IP fence.',
  enabled: 'Enable access gate',
  enabledHint:
    'Off means full bypass (as if absent); on, unauthenticated traffic hits the token page or is refused.',
  mergedHint:
    'Credentials are owned by official auth (launch token exchange, 30-day cookie). Get the current token: run dshctl url on the server, or visit /dsh-plus/gate/launch-url locally.',
  allowedIps: 'Additional IP fence allowlist',
  allowedIpsHint:
    'One per line: exact IP or CIDR (IPv4/IPv6). When non-empty only listed sources may pass or log in; empty = no IP restriction (official login only).',
  autoLoginHint:
    'Trusted-IP auto login: mint the official login cookie automatically for unauthenticated allowlisted sources, no launch token needed. Enabling trusts every allowlisted device (inside the tailnet); keep the allowlist accurate.',
  trustForwardedFor: 'Trust x-forwarded-for for client IP',
  trustForwardedForHint:
    'Enable only when the entry proxy overwrites that header (tailscale serve does); must be off for direct exposure.',
  diagTitle: 'This page',
  diagVerdict: 'Verdict',
  diagClientIp: 'Client IP',
  diagReason: 'Reason',
  diagLocal: 'loopback',
  diagCookie: 'official cookie',
  diagTrustedIp: 'trusted IP allowlist',
  diagOfficial: 'Official login',
  diagOfficialYes: 'authenticated',
  diagOfficialNo: 'not authenticated',
  diagPass: 'pass',
  diagBlock: 'blocked',
  diagTokenPage: 'token page',
  diagAutoLogin: 'Auto login',
  diagAutoLoginVerdict: 'auto login (token-free entry)',
  diagAutoLoginReady: 'ready (signing secret readable)',
  diagAutoLoginNoSecret: 'unavailable (signing secret unreadable, degraded)',
  diagOff: 'gate disabled',
  diagInvalid: 'Allowlist entries that failed to parse:',
}

export const zh: Record<string, string> = mergeDict(commonZh, ownZh)
export const en: Record<string, string> = mergeDict(commonEn, ownEn)
