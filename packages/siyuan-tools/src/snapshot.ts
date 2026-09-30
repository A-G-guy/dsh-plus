/**
 * 写前数据历史快照：对齐思源内置 agent 的自动快照行为
 * （kernel/agent/agent.go：确认之后、执行之前，对整个会话最多打一次；
 *  快照失败即中止写入 —— `IndexRepo` 与 MCP `repo.create` 同一 API）。
 *
 * `needsSnapshot` 逐行镜像官方 `needsLocalSnapshot`：ActionEffects 表优先，
 * 其后 safeActions / safeWholeTools / safeNativeToolActions / 作用域表。
 * 表值直接取自本机同版本（3.8.6）的 kernel/mcptools 源码，仅作读写分类用。
 * @module @dsh-plus/siyuan-tools/snapshot
 */
import type { CapabilityEntry } from '@dsh-plus/siyuan'
import { SNAPSHOT_MEMO } from '@dsh-plus/siyuan'

import type { SiyuanToolsConfig } from './config.ts'
import { actionOf } from './policy.ts'

/** 每工具 action 效果表（官方 ActionEffects；`localWrite` = 快照有回滚价值）。 */
const ACTION_EFFECTS: Record<string, Map<string, { localWrite: boolean }>> = {}
for (const [tool, table] of Object.entries({
  asset: { upload: true, create_html: true, unused: false, clean: true, stat: false },
  bazaar: {
    list: false,
    installed: false,
    updates: false,
    readme: false,
    install: true,
    uninstall: true,
    update: true,
    update_all: true,
    enable: true,
    disable: true,
    install_local: true,
  },
  database: {
    create: true,
    search: false,
    get: false,
    render: false,
    keys: false,
    key_add: true,
    key_update: true,
    key_set_template: true,
    key_remove: true,
    item_add: true,
    item_remove: true,
    item_update: true,
    unused: false,
    clean: true,
  },
  decision: { evaluate: false },
  image: { list: false, analyze: false, generate: true },
  log: { stat: false, tail: false, read: false, search: false },
  search: { fulltext: false, semantic: false, asset: false, getasset: false },
  skill: {
    '': false,
    load: false,
    save: true,
    install: true,
    remove: true,
    rename: true,
    list: false,
  },
  sql: { '': false, query: false },
})) {
  ACTION_EFFECTS[tool] = new Map(
    Object.entries(table).map(([action, localWrite]) => [action, { localWrite }]),
  )
}

/** 官方 safeActions（kernel/agent/agent.go）：读动作免快照。 */
const SAFE_ACTIONS = new Set([
  'get',
  'get_kramdown',
  'get_children',
  'breadcrumb',
  'tree_stat',
  'dom',
  'batch_get',
  'batch_kramdown',
  'list',
  'read',
  'search_docs',
  'fulltext',
  'semantic',
  'search',
  'backlinks',
  'mentions',
  'refresh',
  'labels',
  'status',
  'version',
  'current_time',
  'workspace',
  'info',
  'grep',
  'find',
  'stat',
  'unused',
  'keys',
  'render',
  'diff',
  'file_get',
  'file_open',
  'file_export',
  'open',
  'close',
  'batch-get',
  'md',
  'query',
])

/** 官方 safeWholeTools。 */
const SAFE_WHOLE_TOOLS = new Set([
  'question',
  'todo_write',
  'web_fetch',
  'web_search',
  'search',
  'sql',
])

/** 官方 safeNativeToolActions。 */
const SAFE_NATIVE_ACTIONS: Record<string, Set<string>> = { export: new Set(['html', 'preview']) }

/** 官方显式 External 作用域（快照无回滚价值）。 */
const EXTERNAL_SCOPE = new Set(['decision', 'http_request'])

/**
 * 是否需要在写前打快照（镜像官方 needsLocalSnapshot）。
 * @param rawName - SiYuan 裸能力名。
 * @param args - 模型入参。
 */
export function needsSnapshot(rawName: string, args: unknown): boolean {
  let action = actionOf(args)
  const effects = ACTION_EFFECTS[rawName]?.get(action ?? '')
  if (effects !== undefined) return effects.localWrite
  if (rawName === 'http_request' && action === undefined) action = 'get'
  if (action !== undefined && SAFE_NATIVE_ACTIONS[rawName]?.has(action) === true) return false
  const actionSafe =
    action !== undefined && SAFE_ACTIONS.has(action) && !(rawName === 'import' && action === 'md')
  if (SAFE_WHOLE_TOOLS.has(rawName) || actionSafe) return false
  if (rawName === 'repo' && action === 'create') return false
  if (EXTERNAL_SCOPE.has(rawName)) return false
  return true
}

/** 守卫依赖（测试整体替身）。 */
export interface SnapshotDeps {
  /** 创建数据历史快照（与 `ctx.siyuan.snapshot` 同签名）。 */
  snapshot(memo: string, options: { timeoutMs: number }): Promise<unknown>
  logger: { info(message: string): void; warn(message: string): void }
}

/** 写前守卫：一次会话最多打一次，失败按配置中止或放行。 */
export interface SnapshotGuard {
  beforeWrite(entry: CapabilityEntry, args: Record<string, unknown>): Promise<void>
}

/** 提取错误文本。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 快照结果摘要（尽力解析 id，其余原样截断）。 */
function summarize(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 120)
  try {
    return JSON.stringify(value)?.slice(0, 120) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * 构造写前快照守卫（每插件实例一次 = 每会话一次，对齐官方 `snapshotCreated`）。
 * @param config - 子插件配置（开关、失败处置、超时）。
 * @param deps - 快照执行与日志依赖。
 */
export function createSnapshotGuard(config: SiyuanToolsConfig, deps: SnapshotDeps): SnapshotGuard {
  let done = false
  return {
    async beforeWrite(entry, args) {
      if (config.snapshotBeforeWrite !== true || done) return
      if (!needsSnapshot(entry.name, args)) return
      try {
        const result = await deps.snapshot(SNAPSHOT_MEMO, { timeoutMs: config.toolCallTimeoutMs })
        done = true
        deps.logger.info(`siyuan write snapshot created: ${summarize(result)}`)
      } catch (error) {
        const detail = messageOf(error)
        if (config.snapshotFailure === 'warn') {
          deps.logger.warn(`siyuan write snapshot failed (write allowed): ${detail}`)
          return
        }
        throw new Error(
          `思源写操作已中止：数据历史快照失败（${detail}）。` +
            '请在 SiYuan 设置中启用「数据历史」，或将本插件 snapshotBeforeWrite 设为 false。',
        )
      }
    },
  }
}
