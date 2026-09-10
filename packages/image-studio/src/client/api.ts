/**
 * 数据端点通道（前端预留）：同源 fetch 封装，类型与 dto.ts 对齐。
 * 本次仅交付通道层，不交付调用它的界面。
 * @module image-studio/client/api
 */
import { getJson, postJson } from '@dsh-plus/shared/client'
import type {
  CredentialStatusWire,
  GalleryItem,
  GalleryListWire,
  GenerateAccepted,
  GenerateRequest,
  PresetsWire,
  ProvidersWire,
  TaskWire,
  UploadEntry,
} from '../dto.ts'

const BASE = '/dsh-plus/image-studio'

/** 提交生图任务。 */
export function generate(request: GenerateRequest): Promise<GenerateAccepted> {
  return postJson<GenerateAccepted>(`${BASE}/generate`, request)
}

/** 批量任务轮询。 */
export function fetchTasks(): Promise<{ tasks: TaskWire[] }> {
  return getJson(`${BASE}/tasks`)
}

/** 单任务查询。 */
export function fetchTask(taskId: string): Promise<TaskWire> {
  return getJson(`${BASE}/tasks/${taskId}`)
}

/** 取消任务。 */
export function cancelTask(taskId: string): Promise<{ ok: boolean }> {
  return postJson(`${BASE}/tasks/${taskId}/cancel`)
}

/** 画廊列表应答形状守卫：items 需为数组（渲染期直接 map）。 */
function isGalleryList(value: unknown): value is GalleryListWire {
  if (typeof value !== 'object' || value === null) return false
  return Array.isArray((value as { items?: unknown }).items)
}

/** 画廊列表。 */
export function fetchGallery(): Promise<GalleryListWire> {
  return getJson(`${BASE}/gallery`, isGalleryList)
}

/** 画廊条目详情（含参数回放）。 */
export function fetchGalleryItem(itemId: string): Promise<GalleryItem> {
  return getJson(`${BASE}/gallery/${itemId}`)
}

/** 删除画廊条目。 */
export function deleteGalleryItem(itemId: string): Promise<{ ok: boolean }> {
  return fetch(`${BASE}/gallery/${itemId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  }).then((res) => res.json() as Promise<{ ok: boolean }>)
}

/** 图片 URL（<img src> 直连，非 fetch）。 */
export function imageUrl(imageId: string): string {
  return `${BASE}/images/${imageId}`
}

/** 上传原图 URL（缩略图直连，非 fetch）。 */
export function uploadImageUrl(uploadId: string): string {
  return `${BASE}/uploads/${uploadId}`
}

/** 上传本地图片：raw body 流（query 携带原文件名，仅展示用）。 */
export async function uploadImage(file: File): Promise<UploadEntry> {
  const query = new URLSearchParams({ name: file.name })
  const res = await fetch(`${BASE}/uploads?${query.toString()}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  })
  const body = (await res.json()) as UploadEntry & { error?: string; message?: string }
  if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
  return body
}

/** 上传列表（最新在后；界面自行倒序）。 */
export async function fetchUploads(): Promise<{ items: UploadEntry[]; total: number }> {
  return getJson(`${BASE}/uploads`)
}

/** 凭据状态（describe，永不回传值）。 */
export function fetchCredentialStatus(refName: string): Promise<CredentialStatusWire> {
  return getJson(`${BASE}/credentials/${refName}`)
}

/** 设置凭据值。 */
export function setCredential(refName: string, value: string): Promise<{ ok: boolean }> {
  return postJson(`${BASE}/credentials/${refName}`, { value })
}

/** 删除凭据。 */
export function unsetCredential(refName: string): Promise<{ ok: boolean }> {
  return fetch(`${BASE}/credentials/${refName}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  }).then((res) => res.json() as Promise<{ ok: boolean }>)
}

/** 协议 registry + 参数目录。 */
export function fetchProviders(): Promise<ProvidersWire> {
  return getJson(`${BASE}/providers`)
}

/** 预设只读快照（读写走官方 settings RPC）。 */
export function fetchPresets(): Promise<PresetsWire> {
  return getJson(`${BASE}/presets`)
}
