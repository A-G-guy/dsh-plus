/**
 * 重新加载设置行文案（zh/en）。经 ctx.locale.register 注册、bind 取用，与官方同机制。
 * @module reload/client/i18n
 */

export const NS = 'dsh-plus-reload'

export const zh = {
  title: '重新加载',
  description:
    '立即在进程内重载 profile 组合层（行启停、行配置、组合包、设置），零中断、无需刷新页面；只能重启生效的变更会在结果里点名。',
  action: '重新加载',
  restartAction: '重启服务',
  applying: '重载中…',
  appliedTitle: '已即时生效',
  unsupportedTitle: '进程内重载不可用',
  failedTitle: '重载失败',
  forceTitle: '有会话正在运行',
  forceWarning: '检测到 {n} 个会话正在运行，进程内重载会重建插件行并打断它们。',
  forceWait: '等待',
  forceRun: '强制执行',
  preparing: '预检中…',
  countdownTitle: '即将重启 dsh-web',
  countdownHint: '秒后重启，点击取消可中止。',
  restartNow: '立即重启',
  cancel: '取消',
  agentsWarning: '检测到 {n} 个会话正在运行，重启将打断它们。',
  agentsForce: '仍然重启',
  restartingTitle: '正在重启 dsh-web…',
  restartingHint: '服务恢复后本页将自动刷新。',
  timeoutTitle: '等待服务恢复超时',
  timeoutHint:
    '请手动检查服务状态：journalctl -u dsh-web；或执行 dshctl restart-prod 后自行刷新页面。',
  retry: '重试',
  close: '关闭',
  preflightFailed: '重启预检未通过：',
  tokenExpired: '确认已过期，请重新发起。',
  desktopHint: '桌面端由 Electron 应用管理生命周期：进程内重载可用，「重启服务」不可用。',
} as const

export type DictKey = keyof typeof zh

/** 重新加载行的翻译函数类型。 */
export type Translate = (key: DictKey) => string

// 标注为 Record<DictKey, string>：en 缺任一键即编译期报错（中英强制对齐）。
export const en: Record<DictKey, string> = {
  title: 'Reload',
  description:
    'Reload the profile composition in-process right now (rows, row config, bundles, settings) with no interruption and no page refresh; changes that need a restart are named in the result.',
  action: 'Reload',
  restartAction: 'Restart service',
  applying: 'Reloading…',
  appliedTitle: 'Applied',
  unsupportedTitle: 'In-process reload unavailable',
  failedTitle: 'Reload failed',
  forceTitle: 'Sessions are running',
  forceWarning:
    '{n} session(s) are still running; an in-process reload rebuilds plugin rows and interrupts them.',
  forceWait: 'Wait',
  forceRun: 'Force reload',
  preparing: 'Preflight…',
  countdownTitle: 'Restarting dsh-web soon',
  countdownHint: 'seconds until restart. Cancel to abort.',
  restartNow: 'Restart now',
  cancel: 'Cancel',
  agentsWarning: '{n} session(s) are still running and will be interrupted.',
  agentsForce: 'Restart anyway',
  restartingTitle: 'Restarting dsh-web…',
  restartingHint: 'This page refreshes automatically once the service is back.',
  timeoutTitle: 'Timed out waiting for the service',
  timeoutHint:
    'Check the service manually: journalctl -u dsh-web; or run dshctl restart-prod and refresh this page yourself.',
  retry: 'Retry',
  close: 'Close',
  preflightFailed: 'Restart preflight failed:',
  tokenExpired: 'Confirmation expired; please start over.',
  desktopHint:
    'The desktop app owns its lifecycle: in-process reload works, "Restart service" does not.',
}
