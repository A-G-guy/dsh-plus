/**
 * 画廊存储：元数据 JSONL（追加）+ 图片落盘（原子写）。
 * 元数据记录完整请求参数与提示词（二次编辑回放依据）；
 * sourceIds 记录图生图衍生链。落点遵循《插件存储规范》：
 * $DSH_HOME/dsh-plus/image-studio/gallery/{index.jsonl, images/}
 * @module image-studio/gallery/store
 */

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pluginDataPath } from '@dsh-plus/shared'
import { isImageId } from '../images/id.ts'
import { extOfMime } from '../images/mime.ts'
import type { ImageEndpoint } from '../provider/types.ts'

/** 画廊条目元数据（DTO 主体，端点原样投影）。 */
export interface GalleryItem {
  id: string
  createdAt: string
  /** 提供商预设 id（inline 请求时为 null）。 */
  providerPresetId: string | null
  protocol: string
  endpoint: ImageEndpoint
  model: string
  /** 用户输入提示词（原样，非 revised）。 */
  prompt: string
  /** 全部启用的请求参数（请求体快照，含 response_format 等）。 */
  params: Record<string, unknown>
  /** 结果图 id 列表（images/<imageId>.<ext>）。 */
  imageIds: string[]
  /** 每张图的 revised_prompt（与 imageIds 对齐，可为 null）。 */
  revisedPrompts: Array<string | null>
  /** 图生图源图中的画廊图片（本画廊 imageId）；文生图为空。 */
  sourceIds: string[]
  /** 图生图源图中的本地文件上传（uploads 暂存区 id）；上传被回收即失效。 */
  sourceUploads: string[]
}

/**
 * 存储层根路径（惰性解析：DSH_HOME 可能在模块加载后才被测试/dev 环境设置）。
 */
function galleryRoot(): string {
  return pluginDataPath('image-studio', 'gallery')
}

function indexFile(): string {
  return join(galleryRoot(), 'index.jsonl')
}

function imagesDir(): string {
  return join(galleryRoot(), 'images')
}

/** 确保目录存在。 */
async function ensureDirs(): Promise<void> {
  await mkdir(imagesDir(), { recursive: true })
}

/** 旧条目补齐新增字段（sourceUploads 为后加字段，历史 JSONL 里不存在）。 */
function normalizeItem(item: GalleryItem): GalleryItem {
  return {
    ...item,
    sourceIds: item.sourceIds ?? [],
    sourceUploads: item.sourceUploads ?? [],
  }
}

/** 解析 JSONL 全量元数据（坏行跳过并告警；空文件返回空表）。 */
export async function loadGallery(log: (message: string) => void): Promise<GalleryItem[]> {
  let text: string
  try {
    text = await readFile(indexFile(), 'utf8')
  } catch {
    return []
  }
  const items: GalleryItem[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      items.push(normalizeItem(JSON.parse(line) as GalleryItem))
    } catch {
      log(`画廊元数据坏行跳过：${line.slice(0, 80)}`)
    }
  }
  return items
}

/** 追加一条元数据（JSONL 原子性：单行小写入）。 */
async function appendIndex(item: GalleryItem): Promise<void> {
  await ensureDirs()
  await appendFile(indexFile(), `${JSON.stringify(item)}\n`, 'utf8')
}

/** 图片文件绝对路径。 */
function imagePathOf(imageId: string, ext: string): string {
  if (!isImageId(imageId) || !/^[a-z0-9]{2,4}$/.test(ext)) {
    throw new Error(`非法画廊图片标识：${imageId}.${ext}`)
  }
  return join(imagesDir(), `${imageId}.${ext}`)
}

/** 读取图片字节（未知 id 抛错由调用方映射 404）。 */
export async function readImageBytes(imageId: string): Promise<{ data: Uint8Array; ext: string }> {
  const files = await readdir(imagesDir()).catch(() => [] as string[])
  const hit = files.find((name) => name.startsWith(`${imageId}.`))
  if (hit === undefined) throw new Error(`unknown-image: ${imageId}`)
  const ext = hit.slice(imageId.length + 1)
  const data = await readFile(imagePathOf(imageId, ext))
  return { data: new Uint8Array(data), ext }
}

/** 画廊新条目：落图片字节 + 追加元数据（一个事务语义，图片先落）。 */
export async function saveGalleryItem(input: {
  item: Omit<GalleryItem, 'id' | 'createdAt' | 'imageIds' | 'revisedPrompts'>
  images: Array<{ data: Uint8Array; mime: string; revisedPrompt: string | null }>
}): Promise<GalleryItem> {
  await ensureDirs()
  const imageIds: string[] = []
  for (const image of input.images) {
    const imageId = randomUUID()
    const ext = extOfMime(image.mime)
    // 原子写：临时文件 + rename，中断不留半截图片。
    const target = imagePathOf(imageId, ext)
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, image.data)
    await rename(tmp, target)
    imageIds.push(imageId)
  }
  const item: GalleryItem = {
    ...input.item,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    imageIds,
    revisedPrompts: input.images.map((image) => image.revisedPrompt),
  }
  await appendIndex(item)
  return item
}

/** 删除单条：图片文件与 JSONL 行（重写式删除）。 */
export async function deleteGalleryItem(itemId: string): Promise<boolean> {
  const items = await loadGallery(() => {})
  const hit = items.find((item) => item.id === itemId)
  if (hit === undefined) return false
  for (const imageId of hit.imageIds) {
    const files = await readdir(imagesDir()).catch(() => [] as string[])
    for (const name of files) {
      if (name.startsWith(`${imageId}.`)) {
        await rm(join(imagesDir(), name), { force: true })
      }
    }
  }
  const kept = items.filter((item) => item.id !== itemId)
  const tmp = `${indexFile()}.tmp-${process.pid}-${Date.now()}`
  await writeFile(
    tmp,
    kept.map((item) => JSON.stringify(item)).join('\n') + (kept.length > 0 ? '\n' : ''),
    'utf8',
  )
  await rename(tmp, indexFile())
  return true
}

/** 按 imageId 反查所属条目（二次编辑定位元数据用）。 */
export async function itemOfImage(
  imageId: string,
  log: (message: string) => void,
): Promise<GalleryItem | null> {
  const items = await loadGallery(log)
  return items.find((item) => item.imageIds.includes(imageId)) ?? null
}
