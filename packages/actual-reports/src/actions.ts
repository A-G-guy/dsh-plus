/**
 * 命令族汇总：本包对外暴露的全部工具都由这里登记。
 *
 * 各族定义在 `actions-report.ts` / `actions-dashboard.ts` / `actions-reference.ts`，
 * 这里只做登记与转出，避免单文件涨过行数上限。
 * @module @dsh-plus/actual-reports/actions
 */

import { DASHBOARD_FAMILY } from './actions-dashboard.ts'
import { REFERENCE_FAMILY } from './actions-reference.ts'
import { REPORT_FAMILY } from './actions-report.ts'
import type { FamilySpec } from './family.ts'

export * from './actions-dashboard.ts'
export * from './actions-reference.ts'
export * from './actions-report.ts'
export * from './family.ts'

/** 全部命令族（= 暴露给模型的全部工具）。 */
export const FAMILIES: readonly FamilySpec[] = [REPORT_FAMILY, DASHBOARD_FAMILY, REFERENCE_FAMILY]

/** 按族取动作表。 */
export function findFamily(family: string): FamilySpec | undefined {
  return FAMILIES.find((item) => item.family === family)
}
