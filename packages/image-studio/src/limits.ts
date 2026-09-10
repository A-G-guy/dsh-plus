/**
 * 跨半共享的数量/体积上限（单一事实源）。
 * 宿主边界校验与浏览器半控件共用，避免两处各写一个数字而漂移。
 * 纯常量零依赖，浏览器半可安全引入。
 * @module image-studio/limits
 */

/** 单次 edits 请求的源图上限（官方 GPT Image 限制）。 */
export const MAX_SOURCE_IMAGES = 16

/** 单张上传原图体积上限（50MB，对齐官方 images 端点与仓库上传约定）。 */
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024
