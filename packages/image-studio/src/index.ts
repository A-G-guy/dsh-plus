/**
 * dsh 插件：图像工作室。
 * OpenAI Images 协议文生图/图生图（源图可取画廊图片或本地上传），官方全参数
 * 开关化（enabled=false 不进请求），双预设体系（提示词/参数/提供商），并发生图
 * 任务（FIFO + 可配置上限），画廊持久化（元数据 JSONL + 图片落盘）与二次编辑链
 * （sourceIds / sourceUploads）。服务经 ctx.imageStudio 暴露；
 * 前端接口见 docs/README.md「前端接入点」。
 * @module @dsh-plus/image-studio
 */
import type { Context } from '@deepseek-ai/cordis'

import { Config, type ImageStudioConfig } from './config.ts'
import { ImageStudioService } from './service.ts'

export const name = 'dsh-plus-image-studio'

export const inject = ['credentials'] as const

export { credentialRefNameOf, isValidPresetId } from './credentials.ts'
export type {
  CredentialStatusWire,
  GalleryListWire,
  GenerateRequest,
  PresetsWire,
  ProvidersWire,
  SourceRef,
  TaskWire,
  UploadEntry,
} from './dto.ts'
export { type ErrorCode, ImageStudioError, statusOfCode } from './errors.ts'
export type { GalleryItem } from './gallery/store.ts'
export { isImageId } from './images/id.ts'
export { detectImageMime, extOfMime, mimeOfExt } from './images/mime.ts'
export { MAX_SOURCE_IMAGES, UPLOAD_MAX_BYTES } from './limits.ts'
export type { ParamEntry } from './params/catalog.ts'
export { PARAM_CATALOG, paramEntryOf, paramKeysFor } from './params/catalog.ts'
export { checkImageSize, IMAGE_SIZE_RULE, SIZE_PRESETS } from './params/size.ts'
export type { ParamSpec, ParamSpecMap } from './params/spec.ts'
export { normalizeParamSpecs, ParamValidationError, validateParamSpecs } from './params/spec.ts'
export { ImageStudioService } from './service.ts'
export { Config }

declare module '@deepseek-ai/cordis' {
  interface Context {
    imageStudio: ImageStudioService
  }
}

export function apply(ctx: Context, config: ImageStudioConfig): void {
  ctx.plugin(ImageStudioService, config)
}
