/**
 * 结构化错误（独立模块，避免 service ↔ api 循环依赖）。
 * 端点映射为 HTTP 状态码 + 错误码，UI 按码给文案。
 * @module secret-env/errors
 */
export class SecretEnvError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
