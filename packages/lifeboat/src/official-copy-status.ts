/**
 * 官方应急副本的只读状态读取（$DSH_HOME/llm-pi.official-patch.yaml）。
 *
 * 文件契约与 @dsh-plus/llm-pi 同路径：对方常备副本、本包只读消费——零
 * dsh-plus 内部依赖铁律下不 import 对方实现，路径按契约文件名同源派生。
 * 读取一切失败都降级为结构化状态（面板展示与告警文案的输入，绝不抛出）。
 * @module lifeboat/official-copy-status
 */
import { readFile, stat } from 'node:fs/promises'

import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { parse } from 'yaml'

/** 副本文件名（跨包文件契约：llm-pi 写、本包读，改名须两侧同步）。 */
export const OFFICIAL_COPY_FILE = 'llm-pi.official-patch.yaml'

/** 解析上限：超出只报存在性与时间，不读内容（面板/告警不得被大文件拖垮）。 */
const MAX_BYTES = 2 * 1024 * 1024

/** 头注释里的生成警告行前缀（llm-pi 渲染约定）。 */
const WARNING_PREFIX = '# 警告：'

export interface OfficialCopyStatus {
  path: string
  exists: boolean
  /** mtime 毫秒 = 最近生成时间（副本内容不含时间戳）。 */
  updatedAt?: number
  /** llm-pi-ai 覆盖的 provider 数；不可解析时缺省。 */
  routes?: number
  /** 头注释里的生成警告。 */
  warnings: string[]
  /** 存在但无法解析/超限时的说明。 */
  detail?: string
}

/** 副本契约路径（默认读取点）。 */
export function officialCopyPath(): string {
  return dshHomePath(OFFICIAL_COPY_FILE)
}

/** 解析副本内容（纯函数）：头注释警告 + llm-pi-ai 行的 providers 数。 */
export function parseCopyText(
  text: string,
): Pick<OfficialCopyStatus, 'routes' | 'warnings' | 'detail'> {
  const warnings = text
    .split('\n')
    .filter((line) => line.startsWith(WARNING_PREFIX))
    .map((line) => line.slice(WARNING_PREFIX.length))
  let rows: unknown
  try {
    rows = parse(text)
  } catch (error) {
    return {
      warnings,
      detail: `解析失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (!Array.isArray(rows)) return { warnings, detail: '内容不是 patch 列表' }
  if (rows.length === 0) return { routes: 0, warnings }
  const row = rows.find((entry) => (entry as { id?: unknown } | null)?.id === 'llm-pi-ai') as
    | { config?: { providers?: unknown } }
    | undefined
  const providers = row?.config?.providers
  if (providers === null || typeof providers !== 'object') {
    return { warnings, detail: '缺 llm-pi-ai 配置行（副本可能只含禁用行）' }
  }
  return { routes: Object.keys(providers).length, warnings }
}

/** 读取副本状态；缺失/损坏/超限均降级为结构化状态，不抛出。 */
export async function readOfficialCopyStatus(
  path: string = officialCopyPath(),
): Promise<OfficialCopyStatus> {
  let size: number
  let mtimeMs: number
  try {
    const info = await stat(path)
    if (!info.isFile()) return { path, exists: false, warnings: [] }
    size = info.size
    mtimeMs = info.mtimeMs
  } catch {
    return { path, exists: false, warnings: [] }
  }
  const base: OfficialCopyStatus = {
    path,
    exists: true,
    updatedAt: Math.trunc(mtimeMs),
    warnings: [],
  }
  if (size > MAX_BYTES) return { ...base, detail: '文件超出解析上限，未读取内容' }
  try {
    const text = await readFile(path, 'utf-8')
    return { ...base, ...parseCopyText(text) }
  } catch (error) {
    return {
      ...base,
      detail: `读取失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
