/**
 * 行级配置单一事实源（cordis 组合层，dev/prod patch 层可覆盖）。
 * 全部有默认值，正常部署零配置；本插件不持有运行期状态命名空间——
 * 调度态是一次性内存态，进程重启即清，无需持久化。
 * @module reload/config
 */
import z from '@deepseek-ai/schemastery'

/** 行级配置。 */
export const Config = z.object({
  enabled: z
    .boolean()
    .description('重新加载功能总开关（按钮与 /reload 命令同时生效/隐藏）')
    .default(true),
  binName: z
    .string()
    .description('dsh 启动器名：profile 组合层读取与诊断前缀（保持默认除非换了启动器名）')
    .default('dsh'),
  detectPendingRestart: z
    .boolean()
    .description(
      '启动时记录 profile 直接依赖的产物指纹，/reload 据此点名「位于 node_modules、只能重启生效」的包',
    )
    .default(true),
  unitName: z
    .string()
    .description('systemd 托管的 dsh web 单元名（仅重启通道使用）')
    .default('dsh-web'),
  clientCountdownSeconds: z
    .natural()
    .description('设置页「重启服务」点击后、正式确认前的可取消倒计时秒数（客户端 UI 采用）')
    .default(5),
  confirmTokenTtlMs: z
    .natural()
    .description('prepare 签发的一次性确认 token 有效期毫秒数')
    .default(60000),
  serverGraceMs: z
    .natural()
    .description(
      'confirm 后、真正执行 systemctl restart 前的缓冲毫秒数（留给 HTTP 响应/命令结果落盘与 cancel 窗口）',
    )
    .default(800),
  clientPollTimeoutMs: z
    .natural()
    .description('客户端等待服务恢复并自动刷新的超时毫秒数（客户端 UI 采用）')
    .default(30000),
  watchdogIntervalSeconds: z
    .natural()
    .description('客户端被动重启检测的轮询间隔秒数（0 = 关闭；覆盖任何来源的重启）')
    .default(30),
})

export type ReloadConfig = Schemastery.TypeT<typeof Config>
