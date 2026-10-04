/**
 * 模型入参 → CLI argv（纯函数，fixture 单测钉住）。
 *
 * 生成形态：`<family> [action] [位置参数…] [--选项 值…]`。全局项（`--format` 等）
 * 由执行层统一追加，不进本层——模型永远看不到部署方旋钮。
 * @module @dsh-plus/actual-mcp/argv
 */

import type { CliPlan } from './contract.ts'
import { kebabToCamel } from './derive.ts'
import type { CliOption, CommanderHelp } from './help.ts'

/** `buildArgv` 的产物：待执行参数、缺失必选项与被忽略的多余属性。 */
export interface ArgvPlan {
  argv: string[]
  missingRequired: string[]
  ignored: string[]
}

/** 取值选项 → 单个 CLI token；stdin 形态与枚举越界直接抛错（不静默降级）。 */
function renderOptionValue(option: CliOption, value: unknown): string {
  if (option.stdin && value === '-') {
    throw new Error(
      `--${option.name} 的 stdin 形态（-）在此不可用：请改用内联 JSON 参数（如 --data）。`,
    )
  }
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value))
  if (option.choices !== undefined && !option.choices.includes(text)) {
    throw new Error(`--${option.name} 取值非法：${text}（可选：${option.choices.join(', ')}）`)
  }
  return text
}

/** 解析子命令动作 → CLI 子命令名；未知动作抛错，缺失记入 missingRequired。 */
function resolveAction(
  args: Record<string, unknown>,
  plan: CliPlan,
  argv: string[],
  missingRequired: string[],
): void {
  const action = typeof args.action === 'string' ? args.action : undefined
  const mapped = action === undefined ? undefined : plan.actionMap?.[action]
  if (mapped !== undefined) {
    argv.push(mapped)
    return
  }
  if (action !== undefined) {
    const known = Object.keys(plan.actionMap ?? {}).join(', ')
    throw new Error(`未知 action：${action}（${plan.family} 可选：${known}）`)
  }
  missingRequired.push('action')
}

/** 追加位置参数（按 Usage 顺序）；必填项缺失记入 missingRequired。 */
function appendPositionals(
  args: Record<string, unknown>,
  plan: CliPlan,
  invHelp: CommanderHelp,
  argv: string[],
  missingRequired: string[],
  consumed: Set<string>,
): void {
  const posToProp = new Map(
    Object.entries(plan.positionalByProp ?? {}).map(([prop, pos]) => [pos, prop]),
  )
  for (const pos of [...invHelp.positionals, ...invHelp.optionalPositionals]) {
    const prop = posToProp.get(pos) ?? kebabToCamel(pos)
    consumed.add(prop)
    const value = args[prop]
    if (value === undefined || value === null) {
      if (invHelp.positionals.includes(pos)) missingRequired.push(prop)
      continue
    }
    argv.push(String(value))
  }
}

/** 追加选项（布尔只发开关名，取值选项发 `--名 值`）。 */
function appendOptions(
  args: Record<string, unknown>,
  invHelp: CommanderHelp,
  argv: string[],
  missingRequired: string[],
  consumed: Set<string>,
): void {
  for (const option of invHelp.options) {
    const prop = kebabToCamel(option.name)
    consumed.add(prop)
    const value = args[prop]
    if (value === undefined || value === null || value === false) continue
    if (option.value === undefined) {
      argv.push(`--${option.name}`)
      continue
    }
    const rendered = renderOptionValue(option, value)
    if (rendered === '') {
      missingRequired.push(prop)
      continue
    }
    argv.push(`--${option.name}`, rendered)
  }
}

/**
 * 由模型参数与调用级 help 构造 `actual …` argv（不含全局项）。
 * @param args - 模型入参（已冻结的 JSON 对象）。
 * @param plan - CLI 执行计划。
 * @param invHelp - 调用级 help（动作 help 或直连家族 help）。
 * @returns argv 与被忽略的属性；`missingRequired` 非空表示参数不完整。
 * @throws 未知 action、取值越界或 stdin 形态时抛出带指引的错误。
 */
export function buildArgv(
  args: Record<string, unknown>,
  plan: CliPlan,
  invHelp: CommanderHelp,
): ArgvPlan {
  const argv: string[] = []
  const missingRequired: string[] = []
  const consumed = new Set<string>(['action'])
  if (plan.kind === 'subcommands') resolveAction(args, plan, argv, missingRequired)
  appendPositionals(args, plan, invHelp, argv, missingRequired, consumed)
  appendOptions(args, invHelp, argv, missingRequired, consumed)
  const ignored = Object.keys(args).filter((key) => !consumed.has(key))
  return { argv, missingRequired, ignored }
}
