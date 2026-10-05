/**
 * 动作族的公共契约：参数取值、执行上下文与产出形状。
 *
 * 报表族与仪表盘族共用同一套协议（`cli.ts` 负责把 argv 解析成 `ActionFlags`，
 * 各族只实现「动作名 → 载荷与文本」），因此这里不含任何族特有的语义。
 * @module @dsh-plus/actual-reports/action
 */

import type { ActualApiModule } from './api.ts'
import { dayFromDate } from './dates.ts'
import type { OutputFormat } from './render.ts'

/** 动作入参（已解析的布尔/字符串/JSON 文本值）。 */
export interface ActionFlags {
  [prop: string]: string | boolean | undefined
}

/** 一次动作执行所需的上下文。 */
export interface ActionContext {
  access: ActionAccess
  flags: ActionFlags
  format: OutputFormat
  /** 今天的 `yyyy-MM-dd`（注入时钟，测试可固定）。 */
  today: string
}

/** 预算访问面：官方 server handler 调用 + AQL 查询。 */
export interface ActionAccess {
  api: ActualApiModule
  call(name: string, args?: unknown): Promise<unknown>
}

/** 动作产出：机器面载荷 + 人面文本。 */
export interface ActionResult {
  payload: unknown
  /** table/csv 格式下的文本；json 格式下由调用方统一序列化载荷。 */
  text: string
}

/** 取字符串参数。 */
export function stringFlag(flags: ActionFlags, prop: string): string | undefined {
  const value = flags[prop]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`参数 --${prop} 需要字符串值`)
  return value
}

/** 取必填字符串参数。 */
export function requireStringFlag(flags: ActionFlags, prop: string): string {
  const value = stringFlag(flags, prop)
  if (value === undefined || value === '') {
    throw new Error(`缺少必填参数 ${prop}：请对照该动作的参数描述补齐。`)
  }
  return value
}

/** 取布尔参数（缺省为 false）。 */
export function boolFlag(flags: ActionFlags, prop: string): boolean {
  return flags[prop] === true
}

/** 取 JSON 参数（`@file` 展开已由 CLI 层完成）。 */
export function jsonFlag(flags: ActionFlags, prop: string): unknown {
  const raw = stringFlag(flags, prop)
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`参数 --${prop} 不是合法 JSON：${detail}`)
  }
}

/** 注入时钟的「今天」（毫秒时间戳 → `yyyy-MM-dd`）。 */
export function todayOf(nowMs: number): string {
  return dayFromDate(new Date(nowMs))
}
