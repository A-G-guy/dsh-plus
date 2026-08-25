/**
 * 配置单一事实源：cordis 行级 Config（组合默认值）与 settings namespace
 * （用户层，经 dsh-settings-file 持久化到 $DSH_HOME/settings.yaml 热生效）
 * 共用同一 schemastery schema。
 * @module web-terminal/config
 */
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

import { NS_LITERAL } from './ns.ts'

/** settings 命名空间；webui 配置卡片与插件运行期读取同一份。 */
export const SETTINGS_NS = settingsNamespace(NS_LITERAL)

// biome-ignore lint/suspicious/noExplicitAny: dts 可移植性——顶层 schema 的精确类型经 TypeT 消费，显式断掉 cosmokit 推断链
const ConfigSchema: any = z.object({
  enabled: z.boolean().description('总开关（false 时端点 503、WS 升级拒绝）').default(true),
  shellPath: z.string().description('shell 可执行文件路径（空 = $SHELL 或 /bin/bash）').default(''),
  shellArgs: z.array(z.string()).description('附加 shell 参数').default([]),
  cwd: z.string().description('初始工作目录（空 = 家目录）').default(''),
  env: z.dict(z.string()).description('额外环境变量（凭据清洗后合并，可覆盖 TERM）').default({}),
  initialCols: z.natural().min(2).max(500).description('首次挂载前的孵化列数').default(120),
  initialRows: z.natural().min(2).max(500).description('首次挂载前的孵化行数').default(32),
  scrollbackLines: z.natural().description('每会话 scrollback 保留行数').default(10000),
  scrollbackMaxKb: z
    .natural()
    .min(64)
    .description('每会话 scrollback 字节上限（KB）')
    .default(4096),
  maxSessions: z.natural().min(1).max(64).description('并发会话上限').default(8),
  idleTimeoutMs: z
    .natural()
    .description('空闲自动清理毫秒数（零挂载且零输入输出才清；0 = 禁用）')
    .default(1_800_000),
  killGraceMs: z.natural().description('会话清理 TERM→KILL 宽限毫秒数').default(2000),
})

export const Config = ConfigSchema as ReturnType<typeof z.object>

export type WebTerminalConfig = Schemastery.TypeT<typeof ConfigSchema>
