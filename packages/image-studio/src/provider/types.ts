/**
 * 图像生成 provider 抽象：协议无关的请求/结果模型 + 适配器契约。
 * 首批实现 openai-images；后续协议经 ImageProviderRegistry 挂载，不改核心。
 * @module image-studio/provider/types
 */

/** 生图端点（官方 Images API 两类；新增协议可扩展联合）。 */
export type ImageEndpoint = 'generation' | 'edit'

/** 提供商预设经用户层配置实例化后的请求基础（协议、地址、模型、鉴权）。 */
export interface ProviderTarget {
  /** 协议 id（provider registry 键，首批 'openai-images'）。 */
  protocol: string
  /** API 基础地址（如 https://api.openai.com/v1，兼容中转填中转地址）。 */
  baseUrl: string
  /** 模型 id（gpt-image-1 等）。 */
  model: string
  /** 已 resolve 的 API key（每次任务即时 resolve，不缓存）。 */
  apiKey: string
  /** 额外请求头（部分中转要求自定义头）。 */
  extraHeaders?: Record<string, string>
  /** HTTP 代理（空 = 直连）。 */
  proxy: string
  /** 单请求超时毫秒。 */
  timeoutMs: number
}

/** 输入图片（图生图）：宿主持有的字节数据 + MIME。 */
export interface InputImage {
  data: Uint8Array
  mime: string
}

/** 协议无关的归一化生图请求（参数面已按目录裁剪完毕）。 */
export interface NormalizedRequest {
  target: ProviderTarget
  endpoint: ImageEndpoint
  prompt: string
  /** 文生图张数（edits 端点同样合法）。 */
  n: number
  /** 图生图输入图（edit 时 ≥1；generation 恒空）。 */
  images: InputImage[]
  /** 可选 PNG mask（仅 edit；与 images[0] 配对）。 */
  mask: InputImage | null
  /** 除 prompt/n/image/mask 外的协议参数（key → 已验证值，仅含启用项）。 */
  params: Record<string, unknown>
}

/** 单张结果图。 */
export interface GeneratedImage {
  /** 图片字节（宿主已把 url/b64 统一拉取解码）。 */
  data: Uint8Array
  mime: string
  /** 上游改写后的提示词（部分模型返回）。 */
  revisedPrompt: string | null
}

/** 协议适配器解析出的结果。 */
export interface ProviderResult {
  images: GeneratedImage[]
  /** 上游原始 created 时间戳（秒），缺省 null。 */
  createdAt: number | null
}

/** 适配器向上抛的结构化错误：HTTP 状态 + 上游响应摘要。 */
export class ProviderError extends Error {
  readonly status: number
  readonly upstreamBody: string

  constructor(status: number, upstreamBody: string, message?: string) {
    super(message ?? `上游返回 HTTP ${status}`)
    this.name = 'ProviderError'
    this.status = status
    this.upstreamBody = upstreamBody
  }
}

/**
 * 协议适配器契约：registry 按协议 id 构造；适配器只关心
 * NormalizedRequest → HTTP 调用 → ProviderResult 的翻译。
 */
export interface ImageProvider {
  readonly id: string
  readonly endpoints: readonly ImageEndpoint[]
  generate(request: NormalizedRequest, signal: AbortSignal): Promise<ProviderResult>
}
