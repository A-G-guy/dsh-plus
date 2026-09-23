/**
 * 配置单一事实源：cordis 行级 Config（组合默认值）与 settings namespace
 * （用户层，经 dsh-settings-file 持久化到 $DSH_HOME/settings.yaml 热生效）
 * 共用同一 schemastery schema。
 * @module web-terminal/config
 */
import z from '@deepseek-ai/schemastery'
import type { VolatileFields } from '@dsh-plus/shared'

import { NS_LITERAL } from './ns.ts'

/** settings 命名空间（字面量即合法命名空间，0.1.2-alpha.2 起编译期校验；webui 配置卡片与插件运行期读取同一份）。 */
export const SETTINGS_NS = NS_LITERAL

/** 配置入参形态（schema 各字段均有 default，故组合与 settings 层可省略任意字段）。 */
export interface WebTerminalConfigInput {
  enabled?: boolean
  shellPath?: string
  shellArgs?: string[]
  cwd?: string
  env?: Record<string, string>
  initialCols?: number
  initialRows?: number
  scrollbackLines?: number
  scrollbackMaxKb?: number
  maxSessions?: number
  idleTimeoutMs?: number
  killGraceMs?: number
}

/** 解析后形态（default 补齐，字段必填）。 */
export interface WebTerminalConfigResolved {
  enabled: boolean
  shellPath: string
  shellArgs: string[]
  cwd: string
  env: Record<string, string>
  initialCols: number
  initialRows: number
  scrollbackLines: number
  scrollbackMaxKb: number
  maxSessions: number
  idleTimeoutMs: number
  killGraceMs: number
}

/** 活动字段形态（0.1.7 loader 解析产物：volatile 字段为活动引用）。 */
export type WebTerminalConfigFields = VolatileFields<WebTerminalConfigResolved>

// 显式标注而非 `any`：z.object() 的推断类型含 cosmokit 的 `& Dict` 索引签名，
// 直接导出会触发 TS2883（inferred type cannot be named / not portable）并使
// tsdown 的 dts 生成失败。此处若退回 `any`，WebTerminalConfig 会整体失去结构，
// 未知键与错类型赋值全部静默通过——scripts/contract/contract.ts 有对应断言兜底。
//
// 0.1.7：输出面标注为活动字段声明面（VolatileFields 映射，结构兼容 loader 的
// volatile 引用）——全字段 `.volatile()` 后推断输出为活动引用，平面消费契约
// 由 WebTerminalConfigResolved / WebTerminalConfig 保持。
export const Config: z<WebTerminalConfigInput, WebTerminalConfigFields> = z.object({
  enabled: z
    .boolean()
    .description('总开关（false 时端点 503、WS 升级拒绝）')
    .default(true)
    .volatile(),
  shellPath: z
    .string()
    .description('shell 可执行文件路径（空 = $SHELL 或 /bin/bash）')
    .default('')
    .volatile(),
  shellArgs: z.array(z.string()).description('附加 shell 参数').default([]).volatile(),
  cwd: z.string().description('初始工作目录（空 = 家目录）').default('').volatile(),
  env: z
    .dict(z.string())
    .description('额外环境变量（凭据清洗后合并，可覆盖 TERM）')
    .default({})
    .volatile(),
  initialCols: z
    .natural()
    .min(2)
    .max(500)
    .description('首次挂载前的孵化列数')
    .default(120)
    .volatile(),
  initialRows: z
    .natural()
    .min(2)
    .max(500)
    .description('首次挂载前的孵化行数')
    .default(32)
    .volatile(),
  scrollbackLines: z.natural().description('每会话 scrollback 保留行数').default(10000).volatile(),
  scrollbackMaxKb: z
    .natural()
    .min(64)
    .description('每会话 scrollback 字节上限（KB）')
    .default(4096)
    .volatile(),
  maxSessions: z.natural().min(1).max(64).description('并发会话上限').default(8).volatile(),
  idleTimeoutMs: z
    .natural()
    .description('空闲自动清理毫秒数（零挂载且零输入输出才清；0 = 禁用）')
    .default(1_800_000)
    .volatile(),
  killGraceMs: z.natural().description('会话清理 TERM→KILL 宽限毫秒数').default(2000).volatile(),
})

// 0.1.7：全字段 `.volatile()`——条目进入 settings describe 视图（卡片可读写），
// loader 原位提交活动引用。活动引用在运行期由 unwrapVolatile 解包；
// 平面消费契约即解析后形态（TypeT 的输出面已是活动字段声明面，不再用作消费类型）。
export type WebTerminalConfig = WebTerminalConfigResolved
