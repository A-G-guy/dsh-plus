/**
 * 配置单一事实源：cordis 行级 Config（组合默认值，profile patch 层可覆盖）
 * 与 settings namespace（用户层，持久化后热生效）共用同一份 schemastery schema。
 *
 * 分四组：预设显示面、CLI 与连接发现、版本策略与暴露过滤、工具安全策略
 * （其中安全字段由预设定义下发给子插件行）。
 *
 * **全字段 `.volatile()`**：条目进入 settings describe 视图（配置卡片可读写），
 * loader 以活动引用原位提交热更新——消费端必须 `unwrapVolatile` 现取即热
 * （见 service.ts 的 `current()`）。
 *
 * **密钥不进用户层**：`password` / `sessionToken` / `encryptionPassword` 标
 * `.role('secret')`，describe 视图剥除其值、写入用户层也会被遮蔽，因此配置卡片
 * 不提供编辑器——它们只允许 profile 行级注入（`!!js process.env.…`）。
 * 见《插件存储规范》：密钥走环境变量/官方凭据，不落 settings。
 * @module @dsh-plus/actual/config
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_ALWAYS_ASK, DEFAULT_READ_ACTIONS, DEFAULT_READ_TOOLS } from '@dsh-plus/actual-mcp'
import type { UnwrapVolatile } from '@dsh-plus/shared'

import { SETTINGS_NS as NS_LITERAL } from './ns.ts'

/** settings 命名空间（与运行期读取同一份）。 */
export const SETTINGS_NS = NS_LITERAL

export const Config = z.object({
  enabled: z
    .boolean()
    .description('总开关（false = 不注册 actual 预设，等价插件未安装）')
    .default(true)
    .volatile(),
  name: z
    .string()
    .description('预设显示名（设置 → Agent 预设卡片标题）')
    .default('Actual Budget')
    .volatile(),
  description: z
    .string()
    .description('预设说明（设置 → Agent 预设卡片描述）')
    .default(
      '专注操作 Actual Budget：仅暴露从本机 Actual CLI 自动派生的工具（help 树 × MCP tools/list），另配 web 检索/提问/待办辅助工具，写操作需确认。',
    )
    .volatile(),
  order: z.number().description('预设名册排序位').default(11).volatile(),

  serverUrl: z
    .string()
    .description('Actual 同步服务器基址（服务端版本探测 <serverUrl>/info）')
    .default('http://127.0.0.1:5006')
    .volatile(),
  syncId: z
    .string()
    .description(
      '预算 Sync ID（Actual 客户端 → 设置 → 显示高级设置 → Sync ID；空 = 用 ACTUAL_SYNC_ID）',
    )
    .default('')
    .volatile(),
  password: z
    .string()
    .role('secret')
    .description(
      '服务器口令（空 = 用 ACTUAL_PASSWORD / ACTUAL_PASSWORD_FILE；与 sessionToken 二选一）——密钥不进用户层，仅 profile 行级注入',
    )
    .default('')
    .volatile(),
  sessionToken: z
    .string()
    .role('secret')
    .description('会话令牌（优先于 password；空 = 用 ACTUAL_SESSION_TOKEN）——仅 profile 行级注入')
    .default('')
    .volatile(),
  encryptionPassword: z
    .string()
    .role('secret')
    .description(
      '端到端加密口令（仅加密预算需要；空 = 用 ACTUAL_ENCRYPTION_PASSWORD）——仅 profile 行级注入',
    )
    .default('')
    .volatile(),
  dataDir: z
    .string()
    .description('CLI 本地缓存目录（空 = 插件数据目录 cli-data，与用户自有 CLI 隔离）')
    .default('')
    .volatile(),
  cacheTtl: z.number().description('CLI 缓存有效期（秒，官方默认 60）').default(60).volatile(),
  lockTimeout: z
    .number()
    .description('预算目录锁等待上限（秒，官方默认 10）')
    .default(10)
    .volatile(),
  cliCommand: z
    .array(z.string())
    .description(
      'CLI argv 前缀（如 ["node","/path/dist/cli.js"]；空 = 自动：ACTUAL_CLI → PATH actual → 包内 @actual-app/cli）',
    )
    .default([])
    .volatile(),
  cliVersionPolicy: z
    .union(['warn', 'strict'])
    .description(
      'CLI 与服务端 major.minor 不一致时的处置：warn = 告警继续（默认）；strict = 发现直接失败',
    )
    .default('warn')
    .volatile(),

  allow: z
    .array(z.string())
    .description('工具暴露白名单（裸族名，空 = 全部）')
    .default([])
    .volatile(),
  deny: z
    .array(z.string())
    .description('工具暴露黑名单（裸族名，优先于白名单）')
    .default([])
    .volatile(),

  auxTools: z
    .boolean()
    .description('挂载辅助工具行（web_search/web_fetch、ask_user_question、todo_write）')
    .default(true)
    .volatile(),

  personaPrefix: z
    .string()
    .description('预设系统提示词（complete 模式整体生效；空 = 内置 Actual 优化版）')
    .default('')
    .volatile(),
  includeRuntimeContext: z
    .boolean()
    .description('是否注入运行时上下文快照（日期/环境/审批策略等）')
    .default(true)
    .volatile(),
  confirmWrites: z
    .boolean()
    .description('非读操作经 DSH 审批策略确认（审批策略=ask 时弹窗；never/完全权限模式自动通过）')
    .default(true)
    .volatile(),
  readActions: z
    .array(z.string())
    .description('读动作白名单（alwaysAsk 优先；未命中一律落「问」侧）')
    .default([...DEFAULT_READ_ACTIONS])
    .volatile(),
  alwaysAsk: z
    .array(z.string())
    .description('整工具强制确认名单（裸族名）')
    .default([...DEFAULT_ALWAYS_ASK])
    .volatile(),
  readTools: z
    .array(z.string())
    .description('无 action 属性时按族名判读的只读名单')
    .default([...DEFAULT_READ_TOOLS])
    .volatile(),
  toolCallTimeoutMs: z.number().description('单次工具调用超时（毫秒）').default(60_000).volatile(),
  namePrefix: z
    .string()
    .description('模型可见工具名前缀（空 = 用裸族名；族名如 query/server 过于通用，故默认加前缀）')
    .default('actual_')
    .volatile(),
})

/** 活动字段形态（loader 解析产物：volatile 字段为活动引用）。 */
export type ActualConfigFields = Schemastery.TypeT<typeof Config>
/** 平面配置形态（消费面的读取形态，由活动引用解包得到）。 */
export type ActualConfig = UnwrapVolatile<ActualConfigFields>
