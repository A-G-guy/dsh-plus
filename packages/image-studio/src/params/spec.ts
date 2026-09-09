/**
 * 参数开关/自定义模型（ParamSpec）与归一化裁剪纯函数。
 * 每参数：enabled=false 不进请求（用上游默认值）；value 覆盖目录默认。
 * 校验只在系统边界（api.ts）执行；内部基于契约信任。
 * @module image-studio/params/spec
 */
import type { ImageEndpoint } from '../provider/types.ts'
import { paramEntryOf } from './catalog.ts'

/** 单参数的开关 + 自定义值。 */
export interface ParamSpec {
  enabled: boolean
  value?: unknown
}

/** 端点 → 该端点参数表。 */
export type ParamSpecMap = Record<string, ParamSpec>

/** 归一化失败原因（边界校验用，端点转 invalid-request）。 */
export class ParamValidationError extends Error {
  readonly key: string

  constructor(key: string, message: string) {
    super(`参数 ${key} ${message}`)
    this.name = 'ParamValidationError'
    this.key = key
  }
}

/** 校验单个值符合目录条目约束；返回规范值。 */
export function validateParamValue(key: string, value: unknown): unknown {
  const entry = paramEntryOf(key)
  if (entry === null) throw new ParamValidationError(key, '不在参数目录中')
  switch (entry.kind) {
    case 'string':
      if (typeof value !== 'string' || value.length === 0) {
        throw new ParamValidationError(key, '必须是非空字符串')
      }
      return value
    case 'enum':
      if (typeof value !== 'string' || !entry.values?.includes(value)) {
        throw new ParamValidationError(key, `必须是 ${entry.values?.join(' | ') ?? '枚举值'} 之一`)
      }
      return value
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new ParamValidationError(key, '必须是整数')
      }
      if (entry.min !== undefined && value < entry.min) {
        throw new ParamValidationError(key, `不能小于 ${entry.min}`)
      }
      if (entry.max !== undefined && value > entry.max) {
        throw new ParamValidationError(key, `不能大于 ${entry.max}`)
      }
      return value
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new ParamValidationError(key, '必须是布尔值')
      return value
  }
}

/**
 * 校验并归一化一份参数表：仅保留启用且适用于该端点的参数；
 * model 是请求基础（提供商预设承载），不计入协议参数表。
 * 任何禁用/未知/越界项直接抛 ParamValidationError（边界 fail-loud）。
 */
export function normalizeParamSpecs(
  specs: ParamSpecMap,
  endpoint: ImageEndpoint,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(specs)) {
    if (!spec?.enabled) continue
    if (key === 'model') continue
    const entry = paramEntryOf(key)
    if (entry === null) throw new ParamValidationError(key, '不在参数目录中')
    if (!entry.applies.includes(endpoint)) {
      throw new ParamValidationError(key, `不适用于 ${endpoint} 端点`)
    }
    out[key] = validateParamValue(key, spec.value)
  }
  return out
}

/** 校验预设里的参数表（结构合法但可跨端点；应用时再按端点归一化）。 */
export function validateParamSpecs(specs: unknown): ParamSpecMap {
  if (specs === null || typeof specs !== 'object' || Array.isArray(specs)) {
    throw new ParamValidationError('(整体)', '必须是对象')
  }
  const out: ParamSpecMap = {}
  for (const [key, raw] of Object.entries(specs as Record<string, unknown>)) {
    if (raw === null || typeof raw !== 'object') {
      throw new ParamValidationError(key, '条目必须是 { enabled, value? }')
    }
    const spec = raw as { enabled?: unknown; value?: unknown }
    if (typeof spec.enabled !== 'boolean') {
      throw new ParamValidationError(key, 'enabled 必须是布尔值')
    }
    const entry = paramEntryOf(key)
    if (entry === null) throw new ParamValidationError(key, '不在参数目录中')
    const item: ParamSpec = { enabled: spec.enabled }
    if (spec.value !== undefined) {
      item.value = validateParamValue(key, spec.value)
    }
    out[key] = item
  }
  return out
}
