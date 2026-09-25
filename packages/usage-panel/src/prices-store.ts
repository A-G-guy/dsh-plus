/**
 * 价目独立存储：models.dev 导入的批量价目不进配置文件。
 *
 * cordis.patch.yml 是 profile 行级覆盖层（0.1.7 起 settings.update 整值
 * 序列化进该文件），数千条导入价目会淹没配置、且每次保存都重写全量。
 * 导入结果落 `$DSH_HOME/dsh-plus/usage-panel/prices.json`；config.prices
 * 只留手工小集合，费用估算按「手工覆盖导入」合并（见 pricing.mergePriceEntries）。
 * @module usage-panel/prices-store
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { PriceEntry } from './pricing.ts'

/** 价目文件文档（updatedAt = 最近一次导入时间，null = 从未导入）。 */
export interface PricesDocument {
  updatedAt: string | null
  /**
   * 目录来源标注：catalog 折算导入 = 当时的目录 fetchedAt；外部 doc 导入 =
   * null（手工来源，不被自动重导覆盖）；旧版文件缺席 = undefined（视为落后，
   * 首次启动自动重导一次后补齐标注）。
   */
  sourceFetchedAt?: string | null
  entries: PriceEntry[]
}

/** 文件缺席/损坏时的降级值（每次新建，避免调用方误改共享对象）。 */
export function emptyPrices(): PricesDocument {
  return { updatedAt: null, entries: [] }
}

/** 非负有限数读取（缺省/非法一律 0，与 importPrices 口径一致）。 */
function nonNegative(raw: Record<string, unknown>, key: string): number {
  const value = raw[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** 单条价目形状守卫：provider/model 缺席或非串即剔除。 */
function priceOf(value: unknown): PriceEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.provider !== 'string' || raw.provider.length === 0) return null
  if (typeof raw.model !== 'string' || raw.model.length === 0) return null
  return {
    provider: raw.provider,
    model: raw.model,
    inputPerMtok: nonNegative(raw, 'inputPerMtok'),
    outputPerMtok: nonNegative(raw, 'outputPerMtok'),
    cacheReadPerMtok: nonNegative(raw, 'cacheReadPerMtok'),
    cacheWritePerMtok: nonNegative(raw, 'cacheWritePerMtok'),
  }
}

/** 解析价目文档；损坏/形状非法 → null（调用方降级为空文档）。 */
export function parsePrices(text: string): PricesDocument | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const doc = parsed as { updatedAt?: unknown; entries?: unknown; sourceFetchedAt?: unknown }
  if (!Array.isArray(doc.entries)) return null
  const entries = doc.entries.map(priceOf).filter((entry): entry is PriceEntry => entry !== null)
  return {
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null,
    ...(doc.sourceFetchedAt === null || typeof doc.sourceFetchedAt === 'string'
      ? { sourceFetchedAt: doc.sourceFetchedAt }
      : {}),
    entries,
  }
}

/** 序列化价目文档（紧凑 JSON：机器数据，7 千条级别不加缩进）。 */
export function serializePrices(doc: PricesDocument): string {
  return JSON.stringify({
    updatedAt: doc.updatedAt,
    ...(doc.sourceFetchedAt !== undefined ? { sourceFetchedAt: doc.sourceFetchedAt } : {}),
    entries: doc.entries,
  })
}

/** 读价目文件（缺席/损坏 → 空文档，绝不抛错阻塞启动）。 */
export async function loadPrices(path: string): Promise<PricesDocument> {
  if (!existsSync(path)) return emptyPrices()
  try {
    return parsePrices(await readFile(path, 'utf8')) ?? emptyPrices()
  } catch {
    return emptyPrices()
  }
}

/**
 * 写价目文件（同目录临时文件 + rename 原子落盘），返回落盘文档。
 * @param path - 目标绝对路径（调用方经 pluginDataPath 解析，禁止散拼）。
 * @param entries - 本次导入的完整价目（整体替换）。
 * @param sourceFetchedAt - 目录来源标注（catalog fetchedAt；外部 doc 传 null）。
 */
export async function savePrices(
  path: string,
  entries: PriceEntry[],
  sourceFetchedAt: string | null,
): Promise<PricesDocument> {
  const doc: PricesDocument = { updatedAt: new Date().toISOString(), sourceFetchedAt, entries }
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, serializePrices(doc), 'utf8')
  await rename(tmp, path)
  return doc
}
