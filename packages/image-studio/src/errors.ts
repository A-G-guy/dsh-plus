/**
 * 插件内可识别错误：消息即结构化错误码，端点与任务层按码映射 HTTP 状态。
 * @module image-studio/errors
 */

/** 全部错误码（封闭集合，新增协议/端点行为时按需扩充）。 */
export const ERROR_CODES = [
  'unknown-protocol',
  'unknown-endpoint',
  'invalid-request',
  'unknown-source',
  'unknown-task',
  'task-not-runnable',
  'credential-unavailable',
  'settings-unavailable',
  'unsupported-media',
  'upload-too-large',
  'provider-error',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export class ImageStudioError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'ImageStudioError'
    this.code = code
  }
}

/** 按错误码映射 HTTP 状态（端点边界统一使用）。 */
export function statusOfCode(code: string): number {
  switch (code) {
    case 'unknown-protocol':
    case 'unknown-endpoint':
    case 'invalid-request':
    case 'unknown-source':
    case 'unknown-task':
    case 'task-not-runnable':
      return 400
    case 'credential-unavailable':
    case 'settings-unavailable':
      return 409
    case 'unsupported-media':
      return 415
    case 'upload-too-large':
      return 413
    default:
      return 500
  }
}
