/**
 * 配置单一事实源：cordis 行级 Config（组合默认）与 settings namespace
 * （用户层，$DSH_HOME/settings.yaml 热生效）共用同一 schemastery schema。
 * 三组纯用户配置：提示词预设 / 参数预设 / 提供商预设（API key 不在此，
 * 走 credentials，引用名由 preset id 派生）。
 * @module image-studio/config
 */
import z from '@deepseek-ai/schemastery'

import { SETTINGS_NS as NS_LITERAL } from './ns.ts'

/** settings 命名空间（字面量即合法命名空间，编译期校验）。 */
export const SETTINGS_NS = NS_LITERAL

/** 提示词预设（解析后视图）。 */
export interface PromptPresetEntry {
  id: string
  name: string
  text: string
}

/** 参数预设（解析后视图）。 */
export interface ParamPresetEntry {
  id: string
  name: string
  endpoint: 'generation' | 'edit'
  paramSpecs: unknown
}

/** 提供商预设（解析后视图）。 */
export interface ProviderPresetEntry {
  id: string
  name: string
  protocol: string
  baseUrl: string
  model: string
  credentialRef: string
  extraHeaders: Record<string, string>
}

// 显式标注而非 `any`：z.object() 推断类型含 cosmokit 的 `& Dict` 索引签名，
// 直接导出会触发 TS2883（inferred type cannot be named / not portable）并使
// tsdown 的 dts 生成失败。标注成具名契约后既保住类型、又让产物可移植——
// 退回 `any` 会让三个预设数组元素全部退化为 any。
const PromptPreset: z<PromptPresetEntry, PromptPresetEntry> = z.object({
  id: z.string().required().description('预设 id（稳定标识，删除级联引用）'),
  name: z.string().required().description('预设名称'),
  text: z.string().required().description('提示词模板'),
})

const ParamPreset: z<ParamPresetEntry, ParamPresetEntry> = z.object({
  id: z.string().required().description('预设 id'),
  name: z.string().required().description('预设名称'),
  // 用字面量联合而非 z.string()：endpoint 只有两个合法取值，收窄后与
  // ParamPresetEntry['endpoint'] 对齐，拼错端点会在编译期暴露。
  endpoint: z
    .union([z.const('generation'), z.const('edit')])
    .required()
    .description('适用端点：generation | edit'),
  /** 参数表结构由 params/spec 校验，settings 层存原始 JSON。 */
  paramSpecs: z.any().required().description('参数开关表（ParamSpecMap JSON）'),
})

const ProviderPreset: z<ProviderPresetEntry, ProviderPresetEntry> = z.object({
  id: z.string().required().description('预设 id'),
  name: z.string().required().description('预设名称'),
  protocol: z.string().required().description('协议 id（如 openai-images）'),
  baseUrl: z.string().required().description('API 基础地址（含 /v1）'),
  model: z.string().required().description('模型 id'),
  credentialRef: z.string().required().description('凭据引用名（IMAGE_STUDIO_PRESET_*）'),
  extraHeaders: z.dict(z.string()).description('附加请求头（部分中转需要）').default({}),
})

export const Config = z.object({
  promptPresets: z.array(PromptPreset).description('提示词预设').default([]),
  paramPresets: z.array(ParamPreset).description('参数预设').default([]),
  providerPresets: z.array(ProviderPreset).description('提供商预设').default([]),
  maxConcurrent: z.number().min(0).max(16).description('生图任务并发上限（0 = 不限）').default(3),
  requestTimeoutMs: z
    .number()
    .min(10_000)
    .max(600_000)
    .description('单请求超时（毫秒；生图长耗时，默认 5 分钟）')
    .default(300_000),
  proxy: z.string().description('上游请求代理（空 = 直连）').default(''),
  galleryMaxItems: z
    .number()
    .min(0)
    .max(10_000)
    .description('画廊保留上限（条，0 = 不清理；超限按最旧删除）')
    .default(500),
  uploadTtlHours: z
    .number()
    .min(1)
    .max(720)
    .description('上传原图保留时长（小时；未被画廊条目引用的超期即回收）')
    .default(24),
})

export type ImageStudioConfig = Schemastery.TypeT<typeof Config>
