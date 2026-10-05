/**
 * 伴侣 CLI 入口：argv 解析、配置解析、官方 api 加载、会话执行、输出与错误出口。
 *
 * 三条纪律：
 * - **选项表驱动**：合法选项、是否必填、取值类型全部来自 `actions.ts`，解析器不另立规则；
 * - **部署旋钮不进模型面**：`--format` / `--server-url` / `--verbose` 等全局选项只在本层
 *   存在，绝不进 MCP/DSH 工具 schema（模型只看到 action 自己的参数）；
 * - **失败必须显式**：所有错误都带可执行指引，`--format json` 下以单行 JSON 打到 stderr。
 * @module @dsh-plus/actual-reports/cli
 */

import { fileURLToPath } from 'node:url'
import { type ActionContext, type ActionResult, todayOf } from './action.ts'
import {
  type ActionSpec,
  FAMILIES,
  type FamilySpec,
  findAction,
  findFamily,
  type OptionSpec,
} from './actions.ts'
import type { LoadedApi } from './api.ts'
import { loadApi, resolveApiPath } from './api.ts'
import { ACTION_NAMES } from './capability.ts'
import { runDashboardAction } from './dashboard-commands.ts'
import { dayFromDate } from './dates.ts'
import { type ReportsConfig, resolveConfig } from './env.ts'
import { createNodeIo, type ReportsIo } from './node-io.ts'
import type { OutputFormat } from './render.ts'
import { renderJson } from './render.ts'
import { runReportAction } from './report-commands.ts'
import { withBudget } from './session.ts'

/** 运行期依赖（可在测试中整体替身）。 */
export interface CliRuntime {
  io: ReportsIo
  write(text: string): void
  writeError(text: string): void
  /** 读文本文件（`@file` 参数与版本读取用）。 */
  readTextFile(path: string): Promise<string | undefined>
  /** 加载官方 api（默认走 `api.ts` 的运行时解析）。 */
  loadApi(config: ReportsConfig, io: ReportsIo): Promise<LoadedApi>
}

/** 部署侧全局选项（不进模型面）。 */
const GLOBAL_SPECS: readonly OptionSpec[] = [
  {
    prop: 'format',
    flag: 'format',
    type: 'string',
    description: '输出格式：json（默认）/ table / csv',
  },
  { prop: 'verbose', flag: 'verbose', type: 'boolean', description: '把连接与同步过程打到 stderr' },
  { prop: 'serverUrl', flag: 'server-url', type: 'string', description: '覆盖 ACTUAL_SERVER_URL' },
  { prop: 'syncId', flag: 'sync-id', type: 'string', description: '覆盖 ACTUAL_SYNC_ID' },
  { prop: 'dataDir', flag: 'data-dir', type: 'string', description: '覆盖 ACTUAL_DATA_DIR' },
  {
    prop: 'apiPath',
    flag: 'api-path',
    type: 'string',
    description: '直接指定 @actual-app/api 入口',
  },
  {
    prop: 'cliEntry',
    flag: 'cli-entry',
    type: 'string',
    description: '官方 CLI 入口（用于定位它自带的 api）',
  },
  { prop: 'help', flag: 'help', type: 'boolean', description: '显示帮助' },
  { prop: 'version', flag: 'version', type: 'boolean', description: '显示版本' },
]

/** 解析出的原始选项（尚未与选项表对齐）。 */
interface RawFlag {
  name: string
  value: string | undefined
}

/** 解析结果。 */
interface Parsed {
  positionals: string[]
  raw: RawFlag[]
}

/** 取值类型与是否必填都来自选项表的解析结果。 */
export interface ParsedCommand {
  family: FamilySpec
  action: ActionSpec
  flags: Record<string, string | boolean>
  format: OutputFormat
  verbose: boolean
}

/** 解析错误：带指引的用法错误。 */
class UsageError extends Error {}

/** 拆分 `--name=value` 形态。 */
function splitFlag(token: string): RawFlag {
  const body = token.replace(/^--?/, '')
  const index = body.indexOf('=')
  if (index === -1) return { name: body, value: undefined }
  return { name: body.slice(0, index), value: body.slice(index + 1) }
}

/**
 * 第一遍：把 argv 拆成位置参数与原始选项（不判合法性）。
 *
 * 取值规则：`--flag=value` 直接取；`--flag value` 在后一个 token 不以 `-` 开头
 * （或恰为 `-`）时取之。布尔开关因此可以裸写，也不会把动作名吞成取值。
 */
function tokenize(argv: string[]): Parsed {
  const positionals: string[] = []
  const raw: RawFlag[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string
    if (token === '--') break
    if (token === '-h') {
      raw.push({ name: 'help', value: undefined })
      continue
    }
    if (token.startsWith('-')) {
      const flag = splitFlag(token)
      const next = argv[index + 1]
      if (
        flag.value === undefined &&
        next !== undefined &&
        (!next.startsWith('-') || next === '-')
      ) {
        raw.push({ name: flag.name, value: next })
        index += 1
        continue
      }
      raw.push(flag)
      continue
    }
    positionals.push(token)
  }
  return { positionals, raw }
}

/** 选项名 → 选项定义。 */
function specMap(specs: readonly OptionSpec[]): Map<string, OptionSpec> {
  return new Map(specs.map((spec) => [spec.flag, spec]))
}

/** 布尔取值解析。 */
function booleanValue(raw: RawFlag, spec: OptionSpec): boolean {
  if (raw.value === undefined) return true
  if (raw.value === 'true' || raw.value === '1') return true
  if (raw.value === 'false' || raw.value === '0') return false
  throw new UsageError(`选项 --${spec.flag} 只接受 true/false，实际为 ${JSON.stringify(raw.value)}`)
}

/** 第二遍：按选项表校验并取值；未知选项、缺值、缺必填都当场报错。 */
function applyFlags(
  parsed: Parsed,
  action: ActionSpec,
  runtime: CliRuntime,
): Promise<Record<string, string | boolean>> {
  const specs = specMap([...GLOBAL_SPECS, ...action.args])
  const flags: Record<string, string | boolean> = {}
  for (const raw of parsed.raw) {
    const spec = specs.get(raw.name)
    if (spec === undefined) {
      throw new UsageError(
        `未知选项 --${raw.name}。${action.action} 可用选项：${[...action.args.map((item) => `--${item.flag}`), ...GLOBAL_SPECS.map((item) => `--${item.flag}`)].join('、')}`,
      )
    }
    if (spec.type === 'boolean') {
      flags[spec.prop] = booleanValue(raw, spec)
      continue
    }
    if (raw.value === undefined) throw new UsageError(`选项 --${spec.flag} 需要一个值`)
    flags[spec.prop] = raw.value
  }
  for (const spec of action.args) {
    if (spec.required === true && flags[spec.prop] === undefined) {
      throw new UsageError(`缺少必填选项 --${spec.flag}`)
    }
  }
  return expandJsonFlags(flags, action, runtime)
}

/** `@file` 展开：JSON 选项支持从文件读取（`@-` 不支持，stdin 形态明确拒绝）。 */
async function expandJsonFlags(
  flags: Record<string, string | boolean>,
  action: ActionSpec,
  runtime: CliRuntime,
): Promise<Record<string, string | boolean>> {
  const result = { ...flags }
  for (const spec of action.args) {
    if (spec.type !== 'json') continue
    const value = result[spec.prop]
    if (typeof value !== 'string' || !value.startsWith('@')) continue
    const path = value.slice(1)
    if (path === '-' || path === '') {
      throw new UsageError(
        `选项 --${spec.flag} 不支持 stdin 形态（@-）：请给出文件路径或直接内联 JSON。`,
      )
    }
    const text = await runtime.readTextFile(path)
    if (text === undefined) throw new UsageError(`选项 --${spec.flag} 指向的文件读不到：${path}`)
    result[spec.prop] = text
  }
  return result
}

/**
 * 生效的「今天」：给了 `--today` 就用它（严格校验日期形态），否则取注入时钟。
 * @throws 形态不合法时抛出用法错误。
 */
function effectiveToday(flags: Record<string, string | boolean>, io: ReportsIo): string {
  const override = flags.today
  if (override === undefined) return todayOf(io.now())
  if (typeof override !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(override)) {
    throw new UsageError(`--today 需要 yyyy-MM-dd 形态的日期，实际为 ${JSON.stringify(override)}`)
  }
  const parsed = new Date(`${override}T00:00:00`)
  if (Number.isNaN(parsed.getTime()) || dayFromDate(parsed) !== override) {
    throw new UsageError(`--today 不是有效日期：${override}`)
  }
  return override
}

/** 输出格式归一。 */
function formatOf(flags: Record<string, string | boolean>): OutputFormat {
  const value = flags.format
  if (value === undefined) return 'json'
  if (value === 'json' || value === 'table' || value === 'csv') return value
  throw new UsageError(`未知输出格式：${JSON.stringify(value)}（支持 json / table / csv）`)
}

/** 解析完整命令行。 */
async function parseCommand(
  argv: string[],
  runtime: CliRuntime,
): Promise<ParsedCommand | { help: true; family?: string; action?: string }> {
  const parsed = tokenize(argv)
  const [familyName, actionName, ...rest] = parsed.positionals
  if (rest.length > 0) {
    throw new UsageError(
      `多余的位置参数：${rest.join(' ')}（本 CLI 只接受 <族> <动作> 两个位置参数）`,
    )
  }
  const wantsHelp = parsed.raw.some((raw) => raw.name === 'help')
  if (wantsHelp || familyName === undefined) {
    return {
      help: true,
      ...(familyName === undefined ? {} : { family: familyName }),
      ...(actionName === undefined ? {} : { action: actionName }),
    }
  }
  const family = findFamily(familyName)
  if (family === undefined) {
    throw new UsageError(
      `未知的命令族：${familyName}。可用族：${FAMILIES.map((item) => item.family).join(' / ')}`,
    )
  }
  if (actionName === undefined) {
    throw new UsageError(`缺少动作。${family.family} 可用动作：${ACTION_NAMES(family).join(' / ')}`)
  }
  const action = findAction(family, actionName)
  if (action === undefined) {
    throw new UsageError(
      `未知的动作：${family.family} ${actionName}。可用动作：${ACTION_NAMES(family).join(' / ')}`,
    )
  }
  const flags = await applyFlags(parsed, action, runtime)
  return { family, action, flags, format: formatOf(flags), verbose: flags.verbose === true }
}

/** 帮助文本。 */
export function helpText(familyName?: string, actionName?: string): string {
  const family = familyName === undefined ? undefined : findFamily(familyName)
  if (family === undefined) {
    const lines = [
      '用法：actual-reports <命令族> <动作> [选项]',
      '',
      '命令族：',
      ...FAMILIES.map((item) => `  ${item.family.padEnd(10)}${item.summary}`),
      '',
      '全局选项：',
      ...GLOBAL_SPECS.map((spec) => `  --${spec.flag.padEnd(14)}${spec.description}`),
    ]
    return lines.join('\n')
  }
  const action = actionName === undefined ? undefined : findAction(family, actionName)
  if (action === undefined) {
    return [
      `${family.summary}`,
      '',
      `用法：actual-reports ${family.family} <动作> [选项]`,
      '',
      '动作：',
      ...family.actions.map((item) => `  ${item.action.padEnd(10)}${item.summary}`),
      '',
      `用 actual-reports ${family.family} <动作> --help 查看该动作的选项。`,
    ].join('\n')
  }
  return [
    action.summary,
    '',
    `用法：actual-reports ${family.family} ${action.action} [选项]`,
    '',
    '选项：',
    ...action.args.map((spec) => {
      const required = spec.required === true ? '（必填）' : ''
      return `  --${spec.flag} <${spec.type}>${required}\n      ${spec.description}`
    }),
    '',
    `输出：${action.output}`,
    action.readOnly ? '本动作只读，不会修改预算。' : '本动作会修改预算。',
  ].join('\n')
}

/** 版本号读取（package.json 与本文件同包）。 */
async function versionText(runtime: CliRuntime): Promise<string> {
  const path = fileURLToPath(new URL('../package.json', import.meta.url))
  const text = await runtime.readTextFile(path)
  if (text === undefined) return 'unknown'
  try {
    const parsed: unknown = JSON.parse(text)
    const version = (parsed as { version?: unknown }).version
    return typeof version === 'string' ? version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 错误输出（json 格式打结构化错误，便于上层解析）。 */
function reportError(runtime: CliRuntime, format: OutputFormat, message: string): void {
  if (format === 'json') {
    runtime.writeError(renderJson({ error: { message } }))
    return
  }
  runtime.writeError(`错误：${message}`)
}

/** 执行一次 CLI 调用。 */
export async function runCli(argv: string[], runtime: CliRuntime): Promise<number> {
  let format: OutputFormat = 'json'
  try {
    const parsed = await parseCommand(argv, runtime)
    if ('help' in parsed) {
      runtime.write(helpText(parsed.family, parsed.action))
      return 0
    }
    format = parsed.format
    if (parsed.flags.version === true) {
      runtime.write(await versionText(runtime))
      return 0
    }
    const config = await resolveConfig(overridesOf(parsed.flags), {
      env: runtime.io.env,
      readTextFile: (path) => runtime.readTextFile(path),
      homedir: () => runtime.io.homedir(),
    })
    const loaded = await runtime.loadApi(config, runtime.io)
    const log = (message: string): void => {
      if (parsed.verbose) runtime.writeError(message)
    }
    const result = await withBudget(
      config,
      loaded,
      { mutates: !parsed.action.readOnly, log },
      runtime.io,
      async (context) =>
        await runnerOf(parsed.family.family)(parsed.action.action, {
          access: { api: loaded.module, call: context.call },
          flags: parsed.flags,
          format: parsed.format,
          today: effectiveToday(parsed.flags, runtime.io),
        }),
    )
    runtime.write(parsed.format === 'json' ? renderJson(result.payload) : result.text)
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    reportError(runtime, format, message)
    return error instanceof UsageError ? 2 : 1
  }
}

/**
 * 族 → 动作执行器。与 `FAMILIES` 一一对应（有测试钉住，防止加了族忘接执行器）。
 * @throws 族没有对应执行器时抛出（只在开发期漏接线时出现）。
 */
export function runnerOf(
  family: string,
): (action: string, context: ActionContext) => Promise<ActionResult> {
  const runner = RUNNERS[family]
  if (runner === undefined) {
    throw new Error(`命令族 ${family} 没有对应的动作执行器（内部接线缺失）`)
  }
  return runner
}

/** 全局选项 → 配置覆盖项。 */
function overridesOf(flags: Record<string, string | boolean>): {
  serverUrl?: string
  syncId?: string
  dataDir?: string
  apiPath?: string
  cliEntry?: string
} {
  const overrides: Record<string, string> = {}
  for (const prop of ['serverUrl', 'syncId', 'dataDir', 'apiPath', 'cliEntry'] as const) {
    const value = flags[prop]
    if (typeof value === 'string' && value !== '') overrides[prop] = value
  }
  return overrides
}

/** 族 → 执行器表。 */
const RUNNERS: Record<string, (action: string, context: ActionContext) => Promise<ActionResult>> = {
  report: runReportAction,
  dashboard: runDashboardAction,
}

/** Node 运行期实现（bin 入口用）。 */
export function createNodeRuntime(): CliRuntime {
  const io = createNodeIo()
  return {
    io,
    write: (text) => process.stdout.write(`${text}\n`),
    writeError: (text) => process.stderr.write(`${text}\n`),
    readTextFile: async (path) => await io.fs.readText(path),
    loadApi: async (config, ioRef) => await loadApi(await resolveApiPath(config, ioRef)),
  }
}
