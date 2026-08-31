/**
 * dsh-plus secret-env 插件（node 半）。浏览器半见 src/client/client.ts，
 * 经 ./client 导出 + tsdown 构建，由 dsh-client-modules 扫描进 __DSH_BOOT__。
 *
 * 挂载即得：密钥以 $DSH_SECRET_* 变量名向 agent 暴露（dsh-shell-env 执行期
 * 注入，与内建变量同一通道）；值经 dsh-credentials seam 或会话内存持有，
 * 不进消息流、不动 prompt 前缀（缓存率零影响）。不新增工具与提示词——
 * 模型经 bash 原生能力（env | grep ^DSH_）发现变量名。
 * @module @dsh-plus/secret-env
 */
import type { Context } from '@deepseek-ai/cordis'

import { Config, type SecretEnvConfig } from './config.ts'
import { SecretEnvService } from './service.ts'

export const name = 'dsh-plus-secret-env'
export const inject = ['credentials', 'shellEnv'] as const

export { Config }

declare module '@deepseek-ai/cordis' {
  interface Context {
    secretEnv: SecretEnvService
  }
}

export function apply(ctx: Context, config?: SecretEnvConfig): void {
  // config 由加载器按行级 Config schema 补默认后传入；服务内部完成端点挂载。
  ctx.plugin(SecretEnvService, config)
}

export { SecretEnvError } from './errors.ts'
export { SecretEnvService } from './service.ts'
