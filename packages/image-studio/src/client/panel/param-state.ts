/**
 * 参数表单状态纯函数：目录（ParamEntry）驱动的表单状态 ⇄ ParamSpecMap。
 * - 表单值统一字符串/布尔（输入控件友好），提交时按 kind 解析回数值；
 * - 画廊条目 params 回放、参数预设应用、预设另存均经此模块换算；
 * - 纯函数零 DOM 依赖，可 node 单测。
 * @module image-studio/client/panel/param-state
 */
import { isHostParam, type ParamEntry } from '../../params/catalog.ts'
import type { ParamSpecMap } from '../../params/spec.ts'
import type { ImageEndpoint } from '../../provider/types.ts'

/** 表单字段值（integer/enum/string 用字符串承载，boolean 用布尔）。 */
export type ParamFieldValue = string | boolean

/** 单参数表单态。 */
export interface ParamFieldState {
  enabled: boolean
  value: ParamFieldValue
}

/** 参数表单态（key → 字段态）。 */
export type ParamFormState = Record<string, ParamFieldState>

/** 各参数的顺手默认值（启用控件时的预填，非官方默认）。 */
const DEFAULT_VALUES: Record<string, ParamFieldValue> = {
  n: '1',
  size: '1024x1024',
  quality: 'auto',
  background: 'auto',
  output_format: 'png',
  output_compression: '100',
  moderation: 'auto',
  response_format: 'url',
  stream: false,
  partial_images: '0',
  user: '',
  input_fidelity: 'high',
  style: 'vivid',
}

/** 目录条目 → 表单默认值（enum 取首值兜底）。 */
export function defaultValueFor(entry: ParamEntry): ParamFieldValue {
  const known = DEFAULT_VALUES[entry.key]
  if (known !== undefined) return known
  if (entry.kind === 'enum') return entry.values?.[0] ?? ''
  if (entry.kind === 'boolean') return false
  return ''
}

/** 端点可用的目录条目（剔除 host 承载参数 model）。 */
export function paramEntriesFor(
  catalog: readonly ParamEntry[],
  endpoint: ImageEndpoint,
): ParamEntry[] {
  return catalog.filter((entry) => entry.applies.includes(endpoint) && !isHostParam(entry.key))
}

/** 空表单（全部关闭 + 默认值）。 */
export function emptyParamForm(
  catalog: readonly ParamEntry[],
  endpoint: ImageEndpoint,
): ParamFormState {
  const form: ParamFormState = {}
  for (const entry of paramEntriesFor(catalog, endpoint)) {
    form[entry.key] = { enabled: false, value: defaultValueFor(entry) }
  }
  return form
}

/** 表单值 ← 服务端参数值（按 kind 字符串化；未知键忽略）。 */
function fieldValueOf(entry: ParamEntry, value: unknown): ParamFieldValue {
  if (entry.kind === 'boolean') return value === true
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return defaultValueFor(entry)
}

/** 套用参数表（预设应用/画廊回放共用）：仅目录内且端点适用的键生效并启用。 */
export function applyParams(
  catalog: readonly ParamEntry[],
  endpoint: ImageEndpoint,
  params: Record<string, unknown>,
): ParamFormState {
  const form = emptyParamForm(catalog, endpoint)
  for (const entry of paramEntriesFor(catalog, endpoint)) {
    const value = params[entry.key]
    if (value === undefined) continue
    form[entry.key] = { enabled: true, value: fieldValueOf(entry, value) }
  }
  return form
}

/** 参数预设（ParamSpecMap 形态）套用到表单：enabled=false 的键显式关闭。 */
export function applySpecs(
  catalog: readonly ParamEntry[],
  endpoint: ImageEndpoint,
  specs: ParamSpecMap,
): ParamFormState {
  const form = emptyParamForm(catalog, endpoint)
  for (const entry of paramEntriesFor(catalog, endpoint)) {
    const spec = specs[entry.key]
    if (spec === undefined) continue
    form[entry.key] = {
      enabled: spec.enabled,
      value:
        spec.enabled && spec.value !== undefined
          ? fieldValueOf(entry, spec.value)
          : defaultValueFor(entry),
    }
  }
  return form
}

/**
 * 表单 → ParamSpecMap（提交/另存预设共用）：仅导出启用项，integer 按数值解析；
 * 空字符串 integer 视为未填（导出 {enabled:true} 无 value，交由边界校验报错）。
 */
export function formToSpecs(
  catalog: readonly ParamEntry[],
  endpoint: ImageEndpoint,
  form: ParamFormState,
): ParamSpecMap {
  const specs: ParamSpecMap = {}
  for (const entry of paramEntriesFor(catalog, endpoint)) {
    const field = form[entry.key]
    if (field === undefined || !field.enabled) continue
    if (entry.kind === 'boolean') {
      specs[entry.key] = { enabled: true, value: field.value === true }
      continue
    }
    const text = String(field.value).trim()
    if (entry.kind === 'integer') {
      if (text === '') {
        specs[entry.key] = { enabled: true }
        continue
      }
      const parsed = Number(text)
      specs[entry.key] = { enabled: true, value: Number.isNaN(parsed) ? text : parsed }
      continue
    }
    specs[entry.key] = { enabled: true, value: text }
  }
  return specs
}
