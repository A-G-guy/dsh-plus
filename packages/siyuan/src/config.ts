/**
 * 主插件配置（schemastery，扁平单层便于 profile patch 按字段覆盖）。
 *
 * 分三组：预设显示面、连接发现（docker/native/http + token 来源）、
 * 工具暴露与安全策略（其中安全字段由预设定义下发给子插件行）。
 * @module @dsh-plus/siyuan/config
 */
import z from '@deepseek-ai/schemastery'

/**
 * 视为「读」的 action 白名单（跨工具语义收敛；`alwaysAsk` 优先于本表）。
 * 来源：对本机 MCP `tools/list` 全量 action 的逐项审阅（3.8.6），
 * 只收纯查询类动作；新增/改名动作默认落「问」侧，宁多问不漏放。
 */
export const DEFAULT_READ_ACTIONS: string[] = [
  'asset',
  'backlinks',
  'batch-get',
  'batch_get',
  'batch_kramdown',
  'breadcrumb',
  'current_time',
  'diff',
  'dom',
  'file_get',
  'find',
  'fulltext',
  'get',
  'get_children',
  'get_kramdown',
  'getasset',
  'grep',
  'info',
  'keys',
  'labels',
  'list',
  'mentions',
  'query',
  'read',
  'render',
  'search',
  'search_docs',
  'semantic',
  'stat',
  'tree_stat',
  'unused',
  'version',
  'workspace',
]

/**
 * 整工具强制确认名单：外发（http/web/sync）、包管理（bazaar）与
 * 文件系统面（file/unzip/import/export/inbox/image）——即便具体 action
 * 是读类也先过用户确认。
 */
export const DEFAULT_ALWAYS_ASK: string[] = [
  'bazaar',
  'file',
  'http_request',
  'image',
  'import',
  'inbox',
  'export',
  'sync',
  'unzip',
  'web_fetch',
  'web_search',
]

/** 无 action 属性时按工具名判读（降级 CLI 直连命令）。 */
export const DEFAULT_READ_TOOLS: string[] = ['sql', 'search']

/** 写操作前数据历史快照的默认开关（对齐思源内置 agent：首个本地写前打一次）。 */
export const DEFAULT_SNAPSHOT_BEFORE_WRITE = true

/** 快照失败的默认处置：abort = 中止写入（思源内置 agent 的 fail-closed 行为）。 */
export const DEFAULT_SNAPSHOT_FAILURE: 'abort' | 'warn' = 'abort'

/** 自动快照备注（思源内置 agent 用 "AI agent auto snapshot"，此处标明来源）。 */
export const SNAPSHOT_MEMO = 'DSH agent auto snapshot (dsh-plus)'

export const Config = z.object({
  enabled: z
    .boolean()
    .description('总开关（false = 不注册思源笔记预设，等价插件未安装）')
    .default(true),
  name: z.string().description('预设显示名（设置 → Agent 预设卡片标题）').default('思源笔记'),
  description: z
    .string()
    .description('预设说明（设置 → Agent 预设卡片描述）')
    .default(
      '专注操作思源笔记：仅提供从本机 SiYuan 自动派生的工具（MCP × kernel CLI），写操作需确认。',
    ),
  order: z.number().description('预设名册排序位').default(10),

  mode: z
    .union(['auto', 'docker', 'native', 'http'])
    .description('连接形态：auto 探测（docker 容器在跑 → docker，否则 http）')
    .default('auto'),
  endpoint: z
    .string()
    .description(
      'SiYuan HTTP 基址（MCP 端点为 <endpoint>/mcp，版本探测 <endpoint>/api/system/version）',
    )
    .default('http://127.0.0.1:6806'),
  container: z
    .string()
    .description('docker 容器名（空 = 按名称/镜像含 siyuan 自动挑选）')
    .default(''),
  cliCommand: z
    .array(z.string())
    .description('native 形态的 kernel 可执行命令（如 ["siyuan-cli","kernel"]；空 = 无 CLI 兜底）')
    .default([]),
  cliWorkspace: z
    .string()
    .description('CLI -w 工作区路径（空 = docker 用 /siyuan/workspace，native 用 ~/SiYuan）')
    .default(''),
  token: z
    .string()
    .description(
      'API token（空 = 自动：docker exec / 本机 conf/conf.json 读取；亦可 !!js process.env.SIYUAN_TOKEN）',
    )
    .default(''),

  allow: z.array(z.string()).description('工具暴露白名单（空 = 全部）').default([]),
  deny: z.array(z.string()).description('工具暴露黑名单（优先于白名单）').default([]),

  personaPrefix: z
    .string()
    .description('预设系统提示词（complete 模式整体生效；空 = 内置思源优化版）')
    .default(''),
  includeRuntimeContext: z
    .boolean()
    .description('是否注入运行时上下文快照（日期/环境/审批策略等）')
    .default(true),
  confirmWrites: z
    .boolean()
    .description('非读操作经 DSH 审批策略确认（审批策略=ask 时弹窗；never/完全权限模式自动通过）')
    .default(true),
  snapshotBeforeWrite: z
    .boolean()
    .description('首个本地写操作前创建数据历史快照（每会话一次；对齐思源内置 agent）')
    .default(DEFAULT_SNAPSHOT_BEFORE_WRITE),
  snapshotFailure: z
    .union(['abort', 'warn'])
    .description('快照失败处置：abort = 中止写入（官方行为）；warn = 放行但记录告警')
    .default(DEFAULT_SNAPSHOT_FAILURE),
  readActions: z
    .array(z.string())
    .description('读动作白名单（alwaysAsk 优先）')
    .default(DEFAULT_READ_ACTIONS),
  alwaysAsk: z.array(z.string()).description('整工具强制确认名单').default(DEFAULT_ALWAYS_ASK),
  readTools: z
    .array(z.string())
    .description('无 action 属性时按工具名判读的名单（降级直连命令）')
    .default(DEFAULT_READ_TOOLS),
  toolCallTimeoutMs: z.number().description('单次工具调用超时（毫秒）').default(60_000),
  namePrefix: z.string().description('模型可见工具名前缀（空 = 用 MCP/CLI 原名）').default(''),
})

export type SiyuanConfig = Schemastery.TypeT<typeof Config>
