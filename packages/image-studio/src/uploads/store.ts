/**
 * 上传暂存区：图生图源图/遮罩的本地文件上传（blobs + JSONL 索引，原子写）。
 * 与画廊分离——上传图片不属于任何画廊条目；生图成功后由条目的
 * sourceUploads 引用（衍生链可见），未被任何条目引用且超过 TTL 的由
 * pruneUploads 回收（见 docs/repo/插件存储规范.md）。
 * 落点 $DSH_HOME/dsh-plus/image-studio/uploads/{index.jsonl, blobs/}
 * @module image-studio/uploads/store
 */

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pluginDataPath } from '@dsh-plus/shared'
import { isImageId } from '../images/id.ts'
import { extOfMime } from '../images/mime.ts'

/** 上传记录元数据（wire 视图原样投影）。 */
export interface UploadEntry {
  id: string
  createdAt: string
  /** 原始文件名（仅作展示，不参与路径拼接）。 */
  name: string
  mime: string
  ext: string
  /** 字节数。 */
  size: number
}

/** 存储层根路径（惰性解析：DSH_HOME 可能在模块加载后才被测试环境设置）。 */
function uploadsRoot(): string {
  return pluginDataPath('image-studio', 'uploads')
}

function indexFile(): string {
  return join(uploadsRoot(), 'index.jsonl')
}

function blobsDir(): string {
  return join(uploadsRoot(), 'blobs')
}

/** 上传 id 即文件名前缀：uuid 形态白名单，兼作路径穿越防线。 */
function validateUploadId(id: string): string {
  if (!isImageId(id)) throw new Error(`非法上传标识：${id}`)
  return id
}

/** 图片文件绝对路径。 */
function blobPathOf(id: string, ext: string): string {
  validateUploadId(id)
  if (!/^[a-z0-9]{2,4}$/.test(ext)) throw new Error(`非法上传扩展名：${ext}`)
  return join(blobsDir(), `${id}.${ext}`)
}

async function ensureDirs(): Promise<void> {
  await mkdir(blobsDir(), { recursive: true })
}

/** 解析 JSONL 全量索引（坏行跳过并告警；空文件返回空表）。 */
export async function loadUploads(log: (message: string) => void): Promise<UploadEntry[]> {
  let text: string
  try {
    text = await readFile(indexFile(), 'utf8')
  } catch {
    return []
  }
  const items: UploadEntry[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      items.push(JSON.parse(line) as UploadEntry)
    } catch {
      log(`上传索引坏行跳过：${line.slice(0, 80)}`)
    }
  }
  return items
}

/** 单条上传记录查询（未知 id 返回 null）。 */
export async function findUpload(
  id: string,
  log: (message: string) => void,
): Promise<UploadEntry | null> {
  if (!isImageId(id)) return null
  return (await loadUploads(log)).find((item) => item.id === id) ?? null
}

/** 落盘一张上传图片（临时文件 + rename；索引追加在字节落盘之后）。 */
export async function saveUpload(input: {
  name: string
  mime: string
  data: Uint8Array
}): Promise<UploadEntry> {
  await ensureDirs()
  const id = randomUUID()
  const ext = extOfMime(input.mime)
  const target = blobPathOf(id, ext)
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, input.data)
  await rename(tmp, target)
  const entry: UploadEntry = {
    id,
    createdAt: new Date().toISOString(),
    name: input.name,
    mime: input.mime,
    ext,
    size: input.data.byteLength,
  }
  await appendFile(indexFile(), `${JSON.stringify(entry)}\n`, 'utf8')
  return entry
}

/** 读取上传图片字节（未知 id 抛错由调用方映射 404）。 */
export async function readUploadBytes(id: string): Promise<{ data: Uint8Array; ext: string }> {
  const files = await readdir(blobsDir()).catch(() => [] as string[])
  const hit = files.find((name) => name.startsWith(`${id}.`))
  if (hit === undefined) throw new Error(`unknown-upload: ${id}`)
  const ext = hit.slice(id.length + 1)
  const data = await readFile(blobPathOf(id, ext))
  return { data: new Uint8Array(data), ext }
}

/** 删除单条（字节 + 索引行）。 */
async function removeUpload(entry: UploadEntry): Promise<void> {
  await rm(blobPathOf(entry.id, entry.ext), { force: true })
}

/** 索引导出为 JSONL（重写式删除的公共收尾）。 */
async function rewriteIndex(kept: UploadEntry[]): Promise<void> {
  const tmp = `${indexFile()}.tmp-${process.pid}-${Date.now()}`
  await writeFile(
    tmp,
    kept.map((item) => JSON.stringify(item)).join('\n') + (kept.length > 0 ? '\n' : ''),
    'utf8',
  )
  await rename(tmp, indexFile())
}

/**
 * 回收孤儿上传：未被 keepIds 引用且创建时间早于 ttlMs 的条目删除。
 * @returns 删除条数。
 */
export async function pruneUploads(options: {
  keepIds: ReadonlySet<string>
  ttlMs: number
  now?: number
  log: (message: string) => void
}): Promise<number> {
  const { keepIds, ttlMs, log } = options
  const now = options.now ?? Date.now()
  const items = await loadUploads(log)
  const kept: UploadEntry[] = []
  let removed = 0
  for (const item of items) {
    const expired = now - Date.parse(item.createdAt) > ttlMs
    if (!keepIds.has(item.id) && expired) {
      await removeUpload(item).catch((error: unknown) => {
        log(`上传回收失败（忽略）：${item.id} ${String(error)}`)
      })
      removed += 1
      continue
    }
    kept.push(item)
  }
  if (removed > 0) await rewriteIndex(kept)
  return removed
}
