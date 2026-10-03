/**
 * 配置卡片文案（zh/en）。经 ctx.locale.register 注册、bind 取用。
 * 公共键（save/discard/unsaved 等）来自 shared 的 common 字典，本文件只维护业务键。
 * @module web-cache-headers/client/i18n
 */
import { commonEn, commonZh, mergeDict } from '@dsh-plus/shared/client'

export const NS = 'dsh-plus-web-cache-headers'

const ownZh = {
  title: '静态资源长缓存',
  description:
    '为内容哈希命名的 /assets/* 响应补 Cache-Control: immutable，消除每次刷新重复传输约 1.4MB JS/CSS。',
  summaryLine: '给内容寻址的 /assets/* 补 immutable 缓存头，刷新不再全量重下。',
  enabled: '启用长缓存补丁',
  enabledHint:
    '关闭即卸下补丁，响应头恢复 dsh 原生行为（热生效，无需重启）。development 环境恒禁用：保护 dev/HMR 的同 URL 热更新语义。',
  scopeHint:
    '只影响 /assets/*（dist 内容哈希资源）。index.html、favicon、manifest 与 /plugins/* 不在范围内：前者保持每次最新，后者官方已自带 immutable。',
} as const

const ownEn = {
  title: 'Static asset caching',
  description:
    'Adds Cache-Control: immutable to content-hashed /assets/* responses, removing the ~1.4MB JS/CSS re-download on every refresh.',
  summaryLine:
    'Immutable cache headers for content-addressed /assets/*; no full re-download on refresh.',
  enabled: 'Enable immutable-assets patch',
  enabledHint:
    'Off removes the patch and restores native headers (hot, no restart). Always disabled in development to protect same-URL HMR updates.',
  scopeHint:
    'Affects /assets/* only (content-hashed dist files). index.html, favicon, manifest and /plugins/* stay out of scope: the first three must stay fresh, the last is already immutable.',
} as const

export type DictKey = keyof typeof commonZh | keyof typeof ownZh

/** 卡片共用的翻译函数类型（slot 注入的 bind 结果按此消费）。 */
export type Translate = (key: DictKey) => string

// 标注为 Record<DictKey, string>：en 缺任一键即编译期报错（中英强制对齐）。
export const zh: Record<DictKey, string> = mergeDict(commonZh, ownZh)
export const en: Record<DictKey, string> = mergeDict(commonEn, ownEn)
