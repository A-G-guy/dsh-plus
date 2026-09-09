/**
 * 传输对象（DTO）：HTTP 端点 wire 类型，前后端共享
 * （浏览器半 import type 消费，构建期零运行时依赖）。
 * @module image-studio/dto
 */

import type { ParamPresetEntry, PromptPresetEntry, ProviderPresetEntry } from './config.ts'
import type { GalleryItem } from './gallery/store.ts'
import type { ImageEndpoint } from './provider/types.ts'
import type { TaskState } from './task/runner.ts'

/** 任务提交请求体。 */
export interface GenerateRequest {
  /** 提供商预设 id 与 inline 二选一（都传时 inline 优先）。 */
  providerPresetId?: string
  /** inline 提供商（无预设直发；apiKey 走同 preset 凭据通道）。 */
  inlineProvider?: {
    protocol: string
    baseUrl: string
    model: string
  }
  endpoint: ImageEndpoint
  prompt: string
  /** 参数预设 id（先应用，再被 paramSpecs 覆盖）。 */
  paramPresetId?: string
  /** 参数覆盖表（同 ParamSpecMap 形态）。 */
  paramSpecs?: Record<string, { enabled: boolean; value?: unknown }>
  /** 图生图源图（本画廊 imageId；edit 必填 ≥1）。 */
  sourceIds?: string[]
  /** 可选 PNG mask（本画廊 imageId）。 */
  maskId?: string
}

/** 任务记录 wire 视图。 */
export interface TaskWire {
  id: string
  state: TaskState
  endpoint: ImageEndpoint
  model: string
  promptPreview: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  /** 成功时指向画廊条目 id。 */
  galleryItemId: string | null
}

/** 任务提交应答。 */
export interface GenerateAccepted {
  taskId: string
}

/** 画廊删除/查询应答。 */
export interface GalleryListWire {
  items: GalleryItem[]
  total: number
}

/** 凭据状态（describe 投影，永不回传值）。 */
export interface CredentialStatusWire {
  credentialRef: string
  configured: boolean
}

/** providers 端点应答：协议 registry + 参数目录（前端表单依据）。 */
export interface ProvidersWire {
  protocols: Array<{ id: string; label: string; endpoints: ImageEndpoint[] }>
  params: Array<{
    key: string
    kind: string
    values?: readonly string[]
    min?: number
    max?: number
    applies: ImageEndpoint[]
    generation: string
    advanced: boolean
    description: string
  }>
}

/** 预设三组（settings 快照投影）。 */
export interface PresetsWire {
  promptPresets: PromptPresetEntry[]
  paramPresets: ParamPresetEntry[]
  providerPresets: ProviderPresetEntry[]
}
