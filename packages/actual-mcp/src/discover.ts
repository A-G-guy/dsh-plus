/**
 * 能力发现编排：解析 CLI → 采集 help 树（root + 家族 + 动作，有界并发/预算）
 * → 派生能力目录。I/O 全经注入，可整体替身测试。
 * @module @dsh-plus/actual-mcp/discover
 */

import { FAMILY_CAPABILITIES } from '@dsh-plus/actual-reports'

import {
  type CliConfig,
  type CliDeps,
  mergedEnv,
  probeServerVersion,
  resolveCli,
} from './cli-run.ts'
import type { ActualCliBinding, CapabilityEntry } from './contract.ts'
import { buildCatalog, type CatalogOptions, type HelpTree } from './derive.ts'
import { type CommanderHelp, parseCommanderHelp } from './help.ts'

/** help 采集的并发上限：单次约 150–250ms，8 路约 1s 内完成整树。 */
const CONCURRENCY = 8

/** 采集整树的时间预算（毫秒）；超时停止新任务并返回已采集部分。 */
const DEFAULT_DEADLINE_MS = 30_000

/** 有界并发映射：保持输入顺序，失败项由调用方在 fn 内自吞。 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      const item = items[index]
      if (item !== undefined) results[index] = await fn(item, index)
    }
  })
  await Promise.all(workers)
  return results
}

/** 执行一条 `… --help`；失败返回 undefined（采集尽力而为，不阻断发现）。 */
async function execHelp(
  deps: CliDeps,
  binding: ActualCliBinding,
  argv: string[],
): Promise<string | undefined> {
  const [file, ...prefix] = binding.argv
  if (file === undefined) return undefined
  const result = await deps
    .execFile(file, [...prefix, ...argv, '--help'], {
      env: mergedEnv(deps, binding.env),
    })
    .catch(() => undefined)
  return result !== undefined && result.code === 0 ? result.stdout : undefined
}

/** 采集 root help（家族清单的真实来源）。 */
export async function collectRoot(
  deps: CliDeps,
  binding: ActualCliBinding,
): Promise<CommanderHelp> {
  const text = await execHelp(deps, binding, [])
  if (text === undefined) {
    throw new Error(
      `Actual CLI 无法读取 help（${binding.origin}）：请确认安装完整，` +
        '或直接运行 `actual --help` 排查。',
    )
  }
  return parseCommanderHelp(text)
}

/**
 * 采集家族级 help（每个家族一层）。
 * @param deadline - 绝对截止时间戳（毫秒）；超时停止新任务。
 */
export async function collectFamilyHelps(
  deps: CliDeps,
  binding: ActualCliBinding,
  deadline: number,
): Promise<Map<string, CommanderHelp>> {
  const root = await collectRoot(deps, binding)
  const helps = new Map<string, CommanderHelp>()
  await mapLimit(
    root.subcommands.map((sub) => sub.name),
    CONCURRENCY,
    async (family) => {
      if (Date.now() > deadline) return
      const text = await execHelp(deps, binding, [family])
      if (text !== undefined) helps.set(family, parseCommanderHelp(text))
    },
  )
  return helps
}

/** 采集动作级 help（`<family> <action> --help`），键为 `${family} ${action}`。 */
export async function collectActionHelps(
  deps: CliDeps,
  binding: ActualCliBinding,
  families: Map<string, CommanderHelp>,
  deadline: number,
): Promise<Map<string, CommanderHelp>> {
  const jobs: [string, string][] = []
  for (const [family, help] of families) {
    for (const sub of help.subcommands) jobs.push([family, sub.name])
  }
  const helps = new Map<string, CommanderHelp>()
  await mapLimit(jobs, CONCURRENCY, async ([family, action]) => {
    if (family === undefined || action === undefined || Date.now() > deadline) return
    const text = await execHelp(deps, binding, [family, action])
    if (text !== undefined) helps.set(`${family} ${action}`, parseCommanderHelp(text))
  })
  return helps
}

/** 采集完整 help 树（root + 家族 + 动作）。 */
export async function collectHelpTree(
  deps: CliDeps,
  binding: ActualCliBinding,
  options: { deadlineMs?: number } = {},
): Promise<HelpTree> {
  const deadline = Date.now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS)
  const root = await collectRoot(deps, binding)
  const families = await collectFamilyHelps(deps, binding, deadline)
  const actions = await collectActionHelps(deps, binding, families, deadline)
  return { root, families, actions }
}

/**
 * 采集调用级 help（`<family> [action] --help`）；发现阶段未采到时按需补采。
 * @throws help 不可用时抛出带上下文的错误（调用方据此放弃该次调用）。
 */
export async function collectInvokeHelp(
  deps: CliDeps,
  binding: ActualCliBinding,
  family: string,
  action: string | undefined,
): Promise<CommanderHelp> {
  const argv = action === undefined || action === '' ? [family] : [family, action]
  const text = await execHelp(deps, binding, argv)
  if (text === undefined) {
    throw new Error(`Actual CLI 子命令不存在或不可用：${argv.join(' ')}（CLI：${binding.origin}）`)
  }
  return parseCommanderHelp(text)
}

/**
 * 伴侣 CLI 声明的能力条目（报表/仪表盘族）。
 *
 * 这些能力官方 API 与官方 CLI 都不提供，故不在 help 树里，也不属于 MCP tools/list；
 * 由 `@dsh-plus/actual-reports` 声明后直接入目录。伴侣 CLI 解析不到时**不入目录**
 * （宁缺不假：绝不挂一个调不动的工具），只记一条告警。
 *
 * @returns 条目与可选的告警文本。
 */
export function reportsCapabilities(deps: CliDeps): {
  entries: CapabilityEntry[]
  warning?: string
} {
  if (deps.resolveReportsCli?.() === undefined) {
    return {
      entries: [],
      warning:
        '报表/仪表盘能力未启用：找不到伴侣 CLI（@dsh-plus/actual-reports）。' +
        '重新安装本插件包即可恢复；本机 CLI 能力不受影响。',
    }
  }
  return {
    entries: FAMILY_CAPABILITIES.map((capability) => {
      const entry: CapabilityEntry = {
        name: capability.name,
        description: capability.description,
        inputSchema: capability.inputSchema,
        source: 'cli',
        reports: capability.reports,
      }
      if (capability.readOnly) entry.readOnly = true
      return entry
    }),
  }
}

/** 一次完整发现的产物。 */
export interface Discovery {
  binding: ActualCliBinding
  tree: HelpTree
  entries: CapabilityEntry[]
  /** 派生诊断（缺失的动作级 help 等），由调用方记日志。 */
  warnings: string[]
  /** 服务端版本（探测失败为空串）。 */
  serverVersion: string
}

/** 发现选项 = 派生选项 + 采集预算。 */
export interface DiscoverOptions extends CatalogOptions {
  deadlineMs?: number
}

/**
 * 一次完整发现：解析 CLI → 采集 help 树 → 派生目录 → 探测服务端版本。
 * @param config - CLI 与连接配置。
 * @param deps - 注入的 I/O 面。
 * @param options - 命名、只读判定与采集预算。
 * @returns 发现产物；CLI 不可用时抛错（调用方决定重试策略）。
 */
export async function discover(
  config: CliConfig,
  deps: CliDeps,
  options: DiscoverOptions = {},
): Promise<Discovery> {
  const binding = await resolveCli(config, deps)
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS
  const tree = await collectHelpTree(deps, binding, { deadlineMs })
  const { entries, warnings } = buildCatalog(tree, options)
  const extension = reportsCapabilities(deps)
  if (extension.warning !== undefined) warnings.push(extension.warning)
  const serverVersion = await probeServerVersion(deps, config.serverUrl)
  return {
    binding,
    tree,
    entries: [...entries, ...extension.entries],
    warnings,
    serverVersion,
  }
}

/** 解析版本字符串的 `major.minor`。 */
function majorMinor(value: string): string {
  return value.split('.').slice(0, 2).join('.')
}

/**
 * 版本策略判定：CLI 与服务端 `major.minor` 一致即视为匹配。
 *
 * Actual 的服务端是 CRDT 同步中继（不做预算逻辑），两侧无协议版本闸门，
 * 且官方声明「来自更新版本的文件可正常打开」——因此不匹配只作告警，
 * 不当硬失败（`strict` 策略的处置由调用方决定）。
 */
export function versionStatusOf(
  cliVersion: string,
  serverVersion: string,
): 'ok' | 'mismatch' | 'unknown' {
  if (cliVersion === '' || serverVersion === '') return 'unknown'
  return majorMinor(cliVersion) === majorMinor(serverVersion) ? 'ok' : 'mismatch'
}
