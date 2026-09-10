/**
 * 官方 Images API 全参数目录（单一事实源）。
 * 覆盖官方全集（generations + edits 通用、edit 专属、legacy 代际）；
 * 各中转支持的子集不同（如 PackyAPI 不支持 stream），由用户按需启用，
 * 目录不做子集裁剪。前端表单/校验据此目录动态生成。
 * 纯数据 + 纯函数，零依赖，浏览器半可安全引入。
 * @module image-studio/params/catalog
 */
import type { ImageEndpoint } from '../provider/types.ts'

/** 参数值类型（校验与前端控件形态的依据）。 */
export type ParamKind = 'string' | 'integer' | 'enum' | 'boolean'

/** 值域规则 id（目录声明、边界校验与前端提示共用同一实现）。 */
export type ParamRuleId = 'image-size'

/** 单个参数的目录条目。 */
export interface ParamEntry {
  /** 请求体字段名（官方 API 参数名）。 */
  key: string
  /** 值类型。 */
  kind: ParamKind
  /** enum 类型时的合法取值。 */
  values?: readonly string[]
  /** integer 时的下界（含）。 */
  min?: number
  /** integer 时的上界（含）。 */
  max?: number
  /** 结构化值域规则（如尺寸的倍数/比例/像素约束）；无则仅按 kind 校验。 */
  rules?: ParamRuleId
  /** 适用端点（new-array 是目录实现细节，不外泄）。 */
  applies: readonly ImageEndpoint[]
  /** 适用模型代际：current（GPT Image）| dall-e-3 | dall-e-2 | all。 */
  generation: 'current' | 'dall-e-3' | 'dall-e-2' | 'all'
  /** 默认关闭（中转不兼容或旧代际专用，显式启用才发送）。 */
  advanced: boolean
  /** 中文说明（面向用户的简述）。 */
  description: string
}

/** 目录键序即文档序（prompt/model/n 常用在前）。 */
const CATALOG_RAW: readonly ParamEntry[] = [
  {
    key: 'model',
    kind: 'string',
    applies: ['generation', 'edit'],
    generation: 'all',
    advanced: false,
    description: '图像模型 id；请求基础来自提供商预设，此处仅作展示与 inline 覆盖',
  },
  {
    key: 'n',
    kind: 'integer',
    min: 1,
    max: 10,
    applies: ['generation', 'edit'],
    generation: 'current',
    advanced: false,
    description: '生成张数（1-10；部分中转仅支持 1）',
  },
  {
    key: 'size',
    kind: 'string',
    rules: 'image-size',
    applies: ['generation', 'edit'],
    generation: 'current',
    advanced: false,
    description:
      '尺寸：auto 或「宽x高」。推荐 1024x1024 / 1536x1024 / 1024x1536；自定义需宽高为 16 的倍数、长边 ≤3840、比例 ≤3:1、总像素 655360-8294400',
  },
  {
    key: 'quality',
    kind: 'enum',
    values: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    applies: ['generation', 'edit'],
    generation: 'current',
    advanced: false,
    description: '质量档位（xhigh/max 为 image 2.5 新增高档位）',
  },
  {
    key: 'background',
    kind: 'enum',
    values: ['auto', 'transparent', 'opaque'],
    applies: ['generation', 'edit'],
    generation: 'current',
    advanced: false,
    description: '输出背景透明行为（对提示词里的场景背景无影响）',
  },
  {
    key: 'output_format',
    kind: 'enum',
    values: ['png', 'jpeg', 'webp'],
    applies: ['generation', 'edit'],
    generation: 'current',
    advanced: false,
    description: '输出格式（部分中转不支持 webp）',
  },
  {
    key: 'output_compression',
    kind: 'integer',
    min: 0,
    max: 100,
    applies: ['generation', 'edit'],
    generation: 'current',
    advanced: true,
    description: '压缩率 0-100，仅 jpeg/webp 有效',
  },
  {
    key: 'moderation',
    kind: 'enum',
    values: ['auto', 'low'],
    applies: ['generation', 'edit'],
    generation: 'current',
    advanced: true,
    description: '内容审核严格度',
  },
  {
    key: 'response_format',
    kind: 'enum',
    values: ['url', 'b64_json'],
    applies: ['generation', 'edit'],
    generation: 'all',
    advanced: false,
    description: '返回形式；插件两种都会落盘本地化，画廊不受外链过期影响',
  },
  {
    key: 'stream',
    kind: 'boolean',
    applies: ['generation', 'edit'],
    generation: 'current',
    advanced: true,
    description: '流式返回（多数中转不支持，默认关闭）',
  },
  {
    key: 'partial_images',
    kind: 'integer',
    min: 0,
    max: 3,
    applies: ['generation', 'edit'],
    generation: 'current',
    advanced: true,
    description: '流式中间图数量（依赖 stream，默认关闭）',
  },
  {
    key: 'user',
    kind: 'string',
    applies: ['generation', 'edit'],
    generation: 'all',
    advanced: true,
    description: '终端用户标识（业务归因用）',
  },
  {
    key: 'input_fidelity',
    kind: 'enum',
    values: ['low', 'high'],
    applies: ['edit'],
    generation: 'current',
    advanced: false,
    description: '图生图输入保真度（high 更保留原图细节，token 消耗增大）',
  },
  {
    key: 'style',
    kind: 'enum',
    values: ['vivid', 'natural'],
    applies: ['generation'],
    generation: 'dall-e-3',
    advanced: true,
    description: 'dall-e-3 代际风格参数（GPT Image 不需要）',
  },
] as const

/** 只读目录（冻结防运行期篡改）。 */
export const PARAM_CATALOG: readonly ParamEntry[] = Object.freeze(
  CATALOG_RAW.map((entry) => Object.freeze(entry)),
)

/** 按字段名查目录条目。 */
export function paramEntryOf(key: string): ParamEntry | null {
  return PARAM_CATALOG.find((entry) => entry.key === key) ?? null
}

/** 某端点下可用的参数键集合（含 advanced）。 */
export function paramKeysFor(endpoint: ImageEndpoint): readonly string[] {
  return PARAM_CATALOG.filter((entry) => entry.applies.includes(endpoint)).map((entry) => entry.key)
}

/** 官方 API 对指定参数是否本就不发送（由请求基础或输入承载）。 */
export function isHostParam(key: string): boolean {
  return key === 'model'
}
