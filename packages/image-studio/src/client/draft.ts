/**
 * 配置卡片草稿模型与草稿 ↔ settings 载荷转换（无 React/JSX，供 node --test 直接导入）：
 * JSON 字段（extraHeaders / paramSpecs）以文本镜像承载，保存时解析并做本地校验。
 * @module image-studio/client/draft
 */
import type { ImageStudioConfig } from '../config.ts'
import { credentialRefNameOf, isValidPresetId } from '../credentials.ts'
import { validateParamSpecs } from '../params/spec.ts'

/** 编辑态草稿：JSON 字段与数值以文本承载（保存时解析校验）。 */
export interface ProviderDraft {
  id: string
  name: string
  protocol: string
  baseUrl: string
  model: string
  extraHeadersText: string
}

export interface ParamDraft {
  id: string
  name: string
  endpoint: string
  specsText: string
}

export interface PromptDraft {
  id: string
  name: string
  text: string
}

export interface Draft {
  providers: ProviderDraft[]
  params: ParamDraft[]
  prompts: PromptDraft[]
  maxConcurrent: string
  requestTimeoutMs: string
  proxy: string
  galleryMaxItems: string
  uploadTtlHours: string
}

/** 配置值 → 编辑草稿。 */
export function draftOf(value: ImageStudioConfig): Draft {
  return {
    providers: value.providerPresets.map((p) => ({
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      model: p.model,
      extraHeadersText: JSON.stringify(p.extraHeaders ?? {}, null, 2),
    })),
    params: value.paramPresets.map((p) => ({
      id: p.id,
      name: p.name,
      endpoint: p.endpoint,
      specsText: JSON.stringify(p.paramSpecs ?? {}, null, 2),
    })),
    prompts: value.promptPresets.map((p) => ({ id: p.id, name: p.name, text: p.text })),
    maxConcurrent: String(value.maxConcurrent),
    requestTimeoutMs: String(value.requestTimeoutMs),
    proxy: value.proxy,
    galleryMaxItems: String(value.galleryMaxItems),
    uploadTtlHours: String(value.uploadTtlHours),
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 草稿 → settings 载荷（边界校验：JSON 解析、参数表校验、预设 id 形态）。 */
export function payloadOf(draft: Draft): Record<string, unknown> {
  const providers = draft.providers.map((p) => {
    if (!isValidPresetId(p.id)) throw new Error(p.id)
    return {
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      model: p.model,
      credentialRef: credentialRefNameOf(p.id),
      extraHeaders: parseJson(p.extraHeadersText, p.id) as Record<string, string>,
    }
  })
  const params = draft.params.map((p) => ({
    id: p.id,
    name: p.name,
    endpoint: p.endpoint,
    paramSpecs: validateParamSpecs(parseJson(p.specsText, p.id)),
  }))
  return {
    promptPresets: draft.prompts.map((p) => ({ id: p.id, name: p.name, text: p.text })),
    paramPresets: params,
    providerPresets: providers,
    maxConcurrent: Math.max(0, Math.floor(Number(draft.maxConcurrent) || 0)),
    requestTimeoutMs: Math.max(10_000, Math.floor(Number(draft.requestTimeoutMs) || 300_000)),
    proxy: draft.proxy,
    galleryMaxItems: Math.max(0, Math.floor(Number(draft.galleryMaxItems) || 0)),
    uploadTtlHours: Math.max(1, Math.floor(Number(draft.uploadTtlHours) || 24)),
  }
}

/** 空提供商预设（新增行用；协议取目录首项）。 */
export function emptyProviderDraft(protocol: string): ProviderDraft {
  return { id: '', name: '', protocol, baseUrl: '', model: '', extraHeadersText: '{}' }
}

/** 空参数预设（新增行用；id 由时间戳生成，行序即身份）。 */
export function emptyParamDraft(): ParamDraft {
  return {
    id: `param-${Date.now().toString(36)}`,
    name: '',
    endpoint: 'generation',
    specsText: '{}',
  }
}

/** 空提示词预设（新增行用）。 */
export function emptyPromptDraft(): PromptDraft {
  return { id: `prompt-${Date.now().toString(36)}`, name: '', text: '' }
}
