/**
 * 凭据解析：Actual 的三个密钥走官方 credentials seam
 * （`$DSH_HOME/.credentials.yaml`，经 `ctx.credentials`），**每次操作即时
 * resolve、不跨操作缓存**——在配置卡片里改口令后，下一次工具调用即生效。
 *
 * 引用名即官方 CLI 原生读取的环境变量名（见 refs.ts 与 `@dsh-plus/actual-mcp`
 * 的 `SECRET_ENV`）：`ACTUAL_` 前缀符合《插件存储规范》的 `<PLUGIN_ID>_` 大写
 * 约定，同时让 seam 的继承环境层与 CLI 自己的环境读取指向同一处配置——
 * 无论口令来自 `.credentials.yaml` 还是进程环境，两条路径都拿得到。
 *
 * 优先级：**行级 Config 声明了任一种认证即整组生效**。`role('secret')` 字段
 * 是部署方在 profile 里的显式意图，不该被 seam 里的另一半悄悄改写；只有在
 * 行级配置没声明认证时才去问 seam。端到端加密口令与认证正交，单独解析。
 * @module @dsh-plus/actual/credentials
 */

import type { CliSecrets } from '@dsh-plus/actual-mcp'

import { REF_ENCRYPTION_PASSWORD, REF_PASSWORD, REF_SESSION_TOKEN } from './refs.ts'

/**
 * credentials seam 的最小面。
 *
 * 只声明用到的 `resolve`：值的写入发生在浏览器半（官方 `remote.credentials`
 * 命名空间），宿主半不需要 set/unset。
 *
 * 引用名以 `unknown` 收、按普通字符串传：`CredentialRef` 是
 * `string & { readonly [BRAND]: B }` 的**纯编译期**品牌（`BRAND` 只有类型声明，
 * 无运行期取值，官方文档亦声明 `brandString` 不改动值），故传裸环境变量名与
 * 经 `credentialRef()` 品牌化在运行期完全等价。这样本插件不必依赖
 * `@deepseek-ai/dsh-credentials` 的包树，在未挂该 seam 的 profile 里也能 load。
 */
export interface CredentialsFace {
  /** 解析一个引用；未配置返回 undefined。 */
  resolve(ref: unknown): Promise<{ value: string; source: string } | undefined>
}

/** 行级 Config 声明的密钥（空串 = 未声明）。 */
export type DeclaredSecrets = CliSecrets

/** 解析单个引用；seam 缺席或未配置一律视为空串。 */
async function resolveOne(seam: CredentialsFace | null, ref: string): Promise<string> {
  if (seam === null) return ''
  const found = await seam.resolve(ref)
  return found === undefined ? '' : found.value
}

/**
 * 解析本次调用使用的密钥三元组。
 * @param seam - 凭据 seam；缺席（profile 未挂 dsh-credentials）时只用行级配置。
 * @param declared - 行级 Config 声明的密钥。
 * @returns 已定妥优先级的密钥三元组。
 */
export async function resolveSecrets(
  seam: CredentialsFace | null,
  declared: DeclaredSecrets,
): Promise<CliSecrets> {
  // 行级 Config 是显式意图：声明了口令或令牌就整组作数，不再混入 seam 的另一半。
  const authDeclared = declared.password !== '' || declared.sessionToken !== ''
  const password =
    declared.password !== ''
      ? declared.password
      : authDeclared
        ? ''
        : await resolveOne(seam, REF_PASSWORD)
  const sessionToken =
    declared.sessionToken !== ''
      ? declared.sessionToken
      : authDeclared
        ? ''
        : await resolveOne(seam, REF_SESSION_TOKEN)
  const encryptionPassword =
    declared.encryptionPassword !== ''
      ? declared.encryptionPassword
      : await resolveOne(seam, REF_ENCRYPTION_PASSWORD)
  return { password, sessionToken, encryptionPassword }
}
