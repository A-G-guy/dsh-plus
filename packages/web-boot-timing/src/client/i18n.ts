/**
 * 配置卡片文案（zh/en）。经 ctx.locale.register 注册、bind 取用。
 * 公共键（save/discard/unsaved 等）来自 shared 的 common 字典，本文件只维护业务键。
 * @module web-boot-timing/client/i18n
 */
import { commonEn, commonZh, mergeDict } from '@dsh-plus/shared/client'

export const NS = 'dsh-plus-web-boot-timing'

const ownZh = {
  title: '启动计时观测',
  description:
    '采集首屏五相时钟（ttfb / index / DCL / load / 首次可操作）与资源分桶，输出到 console、机读钩子与本地历史。',
  summaryLine: '首屏五相计时与资源分桶观测，输出 console/全局钩子/本地历史。',
  enabled: '启用启动计时观测',
  enabledHint:
    '关闭即不注入配置行，浏览器半零行为（等价插件未安装）。改动在下次页面加载生效（需刷新）。',
  settleMs: '结算延迟（毫秒）',
  settleMsHint:
    'window load 之后等待多久再出报告，给首波 RPC 与绘制留出落账时间；可填 200–10000，默认 1500。',
  invalidSettle: '请输入 200–10000 的整数',
  reloadHint: '配置行在页面加载阶段注入——保存后刷新页面才会用新参数重新采集。',
  outputHint:
    '报告去向：console.info（人读多行）、globalThis.__DSH_PLUS_WEB_BOOT_TIMING_REPORT__（机读）、localStorage 最近 10 次历史。',
} as const

const ownEn = {
  title: 'Boot timing observation',
  description:
    'Collects the five first-paint clocks (ttfb / index / DCL / load / first input) and resource buckets, exported to console, a machine hook, and local history.',
  summaryLine:
    'First-paint phase timings and resource buckets via console, global hook, local history.',
  enabled: 'Enable boot timing observation',
  enabledHint:
    'Off injects no config row and the browser half does nothing (as if absent). Takes effect on the next page load (refresh).',
  settleMs: 'Settle delay (ms)',
  settleMsHint:
    'How long to wait after window load before emitting the report, letting the first RPC/paint wave settle; 200–10000, default 1500.',
  invalidSettle: 'Enter an integer between 200 and 10000',
  reloadHint:
    'The config row is injected during page load — refresh after saving to collect with the new value.',
  outputHint:
    'Report destinations: console.info (human-readable), globalThis.__DSH_PLUS_WEB_BOOT_TIMING_REPORT__ (machine-readable), and the last 10 runs in localStorage.',
} as const

export type DictKey = keyof typeof commonZh | keyof typeof ownZh

/** 卡片共用的翻译函数类型（slot 注入的 bind 结果按此消费）。 */
export type Translate = (key: DictKey) => string

// 标注为 Record<DictKey, string>：en 缺任一键即编译期报错（中英强制对齐）。
export const zh: Record<DictKey, string> = mergeDict(commonZh, ownZh)
export const en: Record<DictKey, string> = mergeDict(commonEn, ownEn)
