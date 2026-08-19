/**
 * 行级配置单一事实源（cordis 组合层，dev/prod patch 层可覆盖）。
 * 全部有默认值，正常部署零配置；本插件不持有运行期状态命名空间——
 * 调度态是一次性内存态，进程重启即清，无需持久化。
 * @module reload/config
 */
import z from '@deepseek-ai/schemastery'

/** 行级配置。 */
export const Config = z.object({
  enabled: z.boolean().description('重新加载功能总开关（按钮与 /reload 命令同时生效/隐藏）').default(true),
  unitName: z.string().description('systemd 托管的 dsh web 单元名').default('dsh-web'),
  clientCountdownSeconds: z.natural()
    .description('设置页点击后、正式确认前的可取消倒计时秒数（客户端 UI 采用）').default(5),
  confirmTokenTtlMs: z.natural().description('prepare 签发的一次性确认 token 有效期毫秒数').default(60000),
  serverGraceMs: z.natural()
    .description('confirm 后、真正执行 systemctl restart 前的缓冲毫秒数（留给 HTTP 响应/命令结果落盘与 cancel 窗口）').default(800),
  clientPollTimeoutMs: z.natural()
    .description('客户端等待服务恢复并自动刷新的超时毫秒数（客户端 UI 采用）').default(30000),
})

export type ReloadConfig = Schemastery.TypeT<typeof Config>
