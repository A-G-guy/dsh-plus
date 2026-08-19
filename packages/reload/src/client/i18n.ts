/**
 * 重新加载设置行文案（zh/en）。经 ctx.locale.register 注册、bind 取用，与官方同机制。
 * @module reload/client/i18n
 */

export const NS = 'dsh-plus-reload'

export const zh: Record<string, string> = {
  title: '重新加载',
  description: '重启 dsh-web 服务使插件变更生效；服务恢复后本页自动刷新，会话不丢失。',
  action: '重新加载',
  preparing: '预检中…',
  countdownTitle: '即将重启 dsh-web',
  countdownHint: '秒后重启，点击取消可中止。',
  restartNow: '立即重启',
  cancel: '取消',
  agentsWarning: '检测到 {n} 个会话正在运行，重启将打断它们。',
  agentsForce: '仍然重启',
  confirming: '确认中…',
  restartingTitle: '正在重启 dsh-web…',
  restartingHint: '服务恢复后本页将自动刷新。',
  timeoutTitle: '等待服务恢复超时',
  timeoutHint: '请手动检查服务状态：journalctl -u dsh-web；或执行 dshctl restart-prod 后自行刷新页面。',
  retry: '重试',
  close: '关闭',
  preflightFailed: '重启预检未通过：',
  confirmFailed: '确认失败：',
  tokenExpired: '确认已过期，请重新发起。',
}

export const en: Record<string, string> = {
  title: 'Reload',
  description: 'Restart the dsh-web service to apply plugin changes; this page refreshes automatically once the service is back. Sessions persist.',
  action: 'Reload',
  preparing: 'Preflight…',
  countdownTitle: 'Restarting dsh-web soon',
  countdownHint: 'seconds until restart. Cancel to abort.',
  restartNow: 'Restart now',
  cancel: 'Cancel',
  agentsWarning: '{n} session(s) are still running and will be interrupted.',
  agentsForce: 'Restart anyway',
  confirming: 'Confirming…',
  restartingTitle: 'Restarting dsh-web…',
  restartingHint: 'This page refreshes automatically once the service is back.',
  timeoutTitle: 'Timed out waiting for the service',
  timeoutHint: 'Check the service manually: journalctl -u dsh-web; or run dshctl restart-prod and refresh this page yourself.',
  retry: 'Retry',
  close: 'Close',
  preflightFailed: 'Restart preflight failed:',
  confirmFailed: 'Confirm failed: ',
  tokenExpired: 'Confirmation expired; please start over.',
}
