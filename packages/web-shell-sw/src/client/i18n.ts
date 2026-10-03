/**
 * 配置卡片文案（zh/en）。经 ctx.locale.register 注册、bind 取用。
 * 公共键（save/discard/unsaved 等）来自 shared 的 common 字典，本文件只维护业务键。
 * @module web-shell-sw/client/i18n
 */
import { commonEn, commonZh, mergeDict } from '@dsh-plus/shared/client'

export const NS = 'dsh-plus-web-shell-sw'

const ownZh = {
  title: '外壳 Service Worker',
  description:
    '内容寻址静态资源 cache-first、index network-first 离线兜底；不触碰 RPC/SSE/网关路由，令牌页永不入缓存。',
  summaryLine: '外壳 Service Worker：静态资源 cache-first、index 离线兜底；不改动 RPC/SSE。',
  enabled: '启用外壳 Service Worker',
  enabledHint:
    '关闭后：浏览器加载时注销本插件的 SW 注册并清空其全部缓存，恢复原生网络行为。开关改动在下次页面加载生效（需刷新）。',
  reloadHint: '改动即时写入配置，但 SW 的注册/注销发生在页面加载阶段——刷新页面后生效。',
  envHint:
    '仅在安全上下文（https 或 localhost）且浏览器支持 Service Worker 时注册；裸 http 局域网直连自动跳过，页面功能不受影响。',
} as const

const ownEn = {
  title: 'Shell service worker',
  description:
    'Cache-first for content-addressed static assets, network-first index with offline fallback; never touches RPC/SSE/gateway routes, token pages never cached.',
  summaryLine:
    'Shell service worker: cache-first assets, offline index fallback; RPC/SSE untouched.',
  enabled: 'Enable shell service worker',
  enabledHint:
    'Off unregisters this plugin’s worker and clears all of its caches on the next page load, restoring native network behavior. Takes effect after a refresh.',
  reloadHint:
    'The change is written immediately, but registration/unregistration happens during page load — refresh to apply.',
  envHint:
    'Registered only in a secure context (https or localhost) with Service Worker support; plain http LAN access skips it and the page works normally.',
} as const

export type DictKey = keyof typeof commonZh | keyof typeof ownZh

/** 卡片共用的翻译函数类型（slot 注入的 bind 结果按此消费）。 */
export type Translate = (key: DictKey) => string

// 标注为 Record<DictKey, string>：en 缺任一键即编译期报错（中英强制对齐）。
export const zh: Record<DictKey, string> = mergeDict(commonZh, ownZh)
export const en: Record<DictKey, string> = mergeDict(commonEn, ownEn)
