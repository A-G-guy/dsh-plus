/**
 * 协议注册表：协议 id → 适配器构造。封闭集合 + 统一注册入口，
 * 新增协议（如 gemini、stable-diffusion 等）只增注册不改核心。
 * @module image-studio/provider/registry
 */
import { ImageStudioError } from '../errors.ts'
import { generateViaOpenAIImages } from './openai-images.ts'
import type { ImageEndpoint, ImageProvider, NormalizedRequest } from './types.ts'

type GenerateFn = (request: NormalizedRequest, signal: AbortSignal) => Promise<ProviderResult>

interface ProtocolEntry {
  /** 协议 id（settings 提供商预设的 protocol 字段取值）。 */
  id: string
  /** 协议名称（前端展示）。 */
  label: string
  /** 支持的端点。 */
  endpoints: readonly ImageEndpoint[]
  /** 生图执行函数。 */
  generate: GenerateFn
}

const PROTOCOLS: readonly ProtocolEntry[] = Object.freeze([
  {
    id: 'openai-images',
    label: 'OpenAI Images API',
    endpoints: ['generation', 'edit'],
    generate: generateViaOpenAIImages,
  },
])

/** 全部已注册协议（前端下拉依据）。 */
export function listProtocols(): Array<Pick<ProtocolEntry, 'id' | 'label' | 'endpoints'>> {
  return PROTOCOLS.map(({ id, label, endpoints }) => ({ id, label, endpoints }))
}

/** 按协议 id 查条目；未知协议抛结构化错误。 */
export function protocolOf(id: string): ProtocolEntry {
  const found = PROTOCOLS.find((entry) => entry.id === id)
  if (found === undefined) {
    throw new ImageStudioError('unknown-protocol', `未知协议：${id}`)
  }
  return found
}

/** 构造适配器（当前实现无状态，直接包一层满足 ImageProvider 契约）。 */
export function createProvider(id: string): ImageProvider {
  const entry = protocolOf(id)
  return {
    id: entry.id,
    endpoints: entry.endpoints,
    generate: (request, signal) => entry.generate(request, signal),
  }
}
