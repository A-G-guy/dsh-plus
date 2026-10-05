/**
 * 预算内的同步偏好与实验开关。
 *
 * 官方界面把设置存在预算的 `preferences` 表里（实验开关是 `flags.<名>`），因此
 * 「公式卡这类实验组件在当前预算里到底能不能渲染」是**可读**的——不必再问用户。
 * 开关全集来自本机 core 的 `FeatureFlag` 声明，未设置的开关按未开启处理（官方
 * 界面同样如此）。
 * @module @dsh-plus/actual-reports/prefs
 */

import type { ReportsAccess } from './report-store.ts'

/** 一行偏好（`value` 一律字符串化；空值表示未设置）。 */
export interface PrefRow {
  id: string
  value: string | null
}

/** 一个实验开关的当前状态。 */
export interface FlagState {
  /** 开关名（官方 `FeatureFlag` 字面量）。 */
  flag: string
  /** 存储键（`flags.<开关名>`）。 */
  prefId: string
  /** 预算里的原始取值；未设置为 null。 */
  value: string | null
  enabled: boolean
}

/** 偏好总览。 */
export interface PrefSummary {
  flags: FlagState[]
  /** 全部偏好行（id → 取值），便于查周首、货币、日期格式等。 */
  prefs: Record<string, string | null>
}

/** 取值字符串化（官方偏好以字符串存储；数字/布尔原样转文本）。 */
function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return null
  return JSON.stringify(value)
}

/**
 * 读取预算的全部同步偏好。
 * @throws 查询未返回数组时抛出（含表名与提示）。
 */
export async function readPreferences(access: ReportsAccess): Promise<PrefRow[]> {
  const result = await access.api.aqlQuery(access.api.q('preferences').select(['*']))
  const data = (result as { data?: unknown }).data
  if (!Array.isArray(data)) {
    throw new Error(
      `读取预算偏好失败：preferences 查询未返回数据数组（实际：${JSON.stringify(result)?.slice(0, 200)}）`,
    )
  }
  return data.map((row) => {
    const record = row as Record<string, unknown>
    return { id: String(record.id ?? ''), value: textOf(record.value) }
  })
}

/** 汇总偏好：全部行 + 实验开关状态（开关全集由调用方从本机 core 取）。 */
export function summarizePrefs(rows: PrefRow[], flags: string[]): PrefSummary {
  const prefs: Record<string, string | null> = {}
  for (const row of rows) prefs[row.id] = row.value
  return {
    prefs,
    flags: flags.map((flag) => {
      const prefId = `flags.${flag}`
      const value = prefId in prefs ? (prefs[prefId] as string | null) : null
      return { flag, prefId, value, enabled: value === 'true' }
    }),
  }
}
